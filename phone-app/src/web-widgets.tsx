import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useCalendars } from 'expo-localization';
import { CLOCK_FACES_SOURCE } from './clock-faces-source';
import { PC_STATS_SOURCE } from './pc-stats-source';
import { pcStatsHistory, setLayerNeeds, subscribePcStats, validNeeds } from './pc-stats-feed';
import { countWakes, WAKE_COUNTER_JS } from './perf-overlay';
import { colors } from './theme';

/** A clock or PC stats widget, and the rectangle (px, in the layer) of its tile's content area. */
export type WebWidget = { id: string; x: number; y: number; width: number; height: number } & (
  | { kind: 'clock'; face?: string; color?: string }
  | { kind: 'stats'; face?: string; metric?: string; color?: string; gpu?: string; columns: number; rows: number }
);

// Clock faces and PC stats widgets are shared web code (pc-companion/src/clock-faces, src/pc-stats).
// One WebView per widget area draws all of them, each in its tile's rectangle, so a page runs one web
// engine, loads the code and fonts once and shares one frame loop. Tiles stay native underneath and
// keep every touch: this layer ignores them.
// ponytail: fonts come from Google Fonts and fall back to system fonts offline; bundle them if offline looks matter.
const HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="color-scheme" content="dark">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@500;600&family=Barlow+Condensed:wght@600&display=swap">
<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;color-scheme:dark}</style>
</head><body><script>
${WAKE_COUNTER_JS}
${CLOCK_FACES_SOURCE.replace(/<\/script/gi, '<\\/script')}
${PC_STATS_SOURCE.replace(/<\/script/gi, '<\\/script')}
FreezeClock.setFrameRate(30);
var shown = {}, last = null;
function mountOne(w, hour12) {
  var host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:' + w.x + 'px;top:' + w.y + 'px;width:' + w.width + 'px;height:' + w.height + 'px;border-radius:6px;overflow:hidden';
  document.body.appendChild(host);
  var handle = w.kind === 'clock'
    ? FreezeClock.mount(host, { face: w.face || 'digital', color: w.color || null, width: w.width, height: w.height, hour12: hour12 })
    : FreezeStats.mount(host, { style: w.face || 'ring', metric: w.metric || 'cpu', color: w.color || null, gpu: w.gpu || 'auto', background: ${JSON.stringify(colors.panel)}, still: true, width: w.width, height: w.height, columns: w.columns, rows: w.rows });
  return { host: host, handle: handle };
}
// Shows exactly \`list\`: widgets whose options or rectangle changed are re-mounted, others kept.
window.freezeWidgets = function (list, hour12, force) {
  last = { list: list, hour12: hour12 };
  var keep = {}, needs = {};
  list.forEach(function (w) {
    var key = JSON.stringify(w) + hour12;
    keep[w.id] = true;
    if (w.kind === 'stats') FreezeStats.needs(w.face || 'ring', w.metric || 'cpu', w.columns, w.rows).forEach(function (n) { needs[n] = true; });
    var item = shown[w.id];
    if (item && item.key === key && !force) return;
    if (item) { item.handle.destroy(); item.host.remove(); }
    shown[w.id] = mountOne(w, hour12);
    shown[w.id].key = key;
  });
  Object.keys(shown).forEach(function (id) { if (!keep[id]) { shown[id].handle.destroy(); shown[id].host.remove(); delete shown[id]; } });
  window.ReactNativeWebView.postMessage(JSON.stringify({ needs: Object.keys(needs).sort() }));
};
// Stats widgets size text by measuring it, so they re-mount once the web fonts arrive.
if (document.fonts) document.fonts.ready.then(function () { if (last) window.freezeWidgets(last.list, last.hour12, true); });
</script></body></html>`;

let nextLayer = 0;

export function WebWidgetLayer({ widgets }: { widgets: WebWidget[] }) {
  const webView = useRef<WebView>(null);
  const layer = useRef(nextLayer++);
  const [loaded, setLoaded] = useState(false);
  const [{ uses24hourClock }] = useCalendars();
  const hour12 = uses24hourClock !== true;
  const list = JSON.stringify(widgets);
  const hasStats = widgets.some((widget) => widget.kind === 'stats');
  useEffect(() => {
    if (loaded) webView.current?.injectJavaScript(`window.freezeWidgets(${list}, ${hour12});true;`);
  }, [loaded, list, hour12]);
  // Leaving the screen withdraws this layer's stats needs.
  useEffect(() => {
    const id = layer.current;
    return () => setLayerNeeds(id, null);
  }, []);
  // Samples go to the page while it shows stats and the app is in the foreground.
  useEffect(() => {
    if (!loaded || !hasStats) return;
    const send = (sample: Record<string, unknown> | null) => {
      if (AppState.currentState !== 'active') return;
      webView.current?.injectJavaScript(sample ? `FreezeStats.push(${JSON.stringify(sample)});true;` : `FreezeStats.setHistory(${JSON.stringify(pcStatsHistory())});true;`);
    };
    send(null);
    const unsubscribe = subscribePcStats(send);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') send(null); });
    return () => { unsubscribe(); subscription.remove(); };
  }, [loaded, hasStats]);
  // Nothing animates while the app is in the background.
  useEffect(() => {
    if (!loaded) return;
    const subscription = AppState.addEventListener('change', (state) => webView.current?.injectJavaScript(`FreezeClock.setPaused(${state !== 'active'});true;`));
    return () => subscription.remove();
  }, [loaded]);
  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const { needs, wakes } = JSON.parse(event.nativeEvent.data) as { needs?: unknown; wakes?: unknown };
      if (validNeeds(needs)) setLayerNeeds(layer.current, needs);
      if (typeof wakes === 'number') countWakes('web widgets', wakes);
    } catch { /* not a message from the page */ }
  };
  // A page without clock or stats widgets runs no web engine at all.
  if (!widgets.length) return null;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <WebView ref={webView} originWhitelist={['*']} source={{ html: HTML }} onLoadStart={() => setLoaded(false)} onLoadEnd={() => setLoaded(true)} onMessage={onMessage} textZoom={100} scrollEnabled={false} bounces={false} overScrollMode="never" showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} setSupportMultipleWindows={false} style={styles.webView} containerStyle={styles.webView} />
  </View>;
}

const styles = StyleSheet.create({
  webView: { flex: 1, backgroundColor: 'transparent' },
});
