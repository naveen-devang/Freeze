import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { PC_STATS_SOURCE } from './pc-stats-source';
import { colors } from './theme';

// The last minute of PC stats samples. It lives outside the connection context so a sample each
// second only redraws the stats widgets, not the whole deck.
type Sample = Record<string, unknown>;
type Listener = (sample: Sample | null) => void;
let history: Sample[] = [];
const listeners = new Set<Listener>();
const isSample = (value: unknown): value is Sample => !!value && typeof value === 'object' && !Array.isArray(value);

// Called by the connection for each pc_stats message: { history: [...] } replaces, { stats } appends.
export function receivePcStats(message: { history?: unknown; stats?: unknown }) {
  if (Array.isArray(message.history)) {
    history = message.history.filter(isSample).slice(-60);
    listeners.forEach((listener) => listener(null));
  } else if (isSample(message.stats)) {
    history = [...history.slice(-59), message.stats];
    listeners.forEach((listener) => listener(message.stats as Sample));
  }
}
export function clearPcStats() {
  history = [];
  listeners.forEach((listener) => listener(null));
}

// What the PC samples is what the stats widgets on screen show. Each mounted widget reports its
// needs (from FreezeStats.needs in its WebView); the connection sends the PC their union, and an
// empty list while none are on screen or the app is in the background.
const needsByWidget = new Map<number, string[]>();
let nextWidget = 0;
let sendNeeds: ((needs: string[]) => void) | null = null;
let lastSent = '';
let pending: ReturnType<typeof setTimeout> | null = null;
function currentNeeds() {
  return AppState.currentState === 'active' ? [...new Set([...needsByWidget.values()].flat())].sort() : [];
}
// Batches the burst of changes when a page of widgets mounts or unmounts.
function publishNeeds(force = false) {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    const needs = currentNeeds(), key = needs.join();
    if (sendNeeds && (force || key !== lastSent)) { sendNeeds(needs); lastSent = key; }
  }, 150);
}
/** Called by the connection: `send` once it's ready, null when it closes. Re-sends the current needs. */
export function setPcStatsSender(send: ((needs: string[]) => void) | null) {
  sendNeeds = send;
  lastSent = '';
  if (send) publishNeeds(true);
}
AppState.addEventListener('change', () => publishNeeds());
const validNeeds = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 16 && value.every((need) => typeof need === 'string' && /^[a-z]{1,16}$/.test(need));

// The widgets are shared web code (pc-companion/src/pc-stats/pc-stats.js), so the phone runs them in
// a WebView like the clock faces. The page re-mounts whenever its options or size change, and tells
// the app which readings it shows.
const HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="color-scheme" content="dark">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;color-scheme:dark}#host{width:100vw;height:100vh}</style>
</head><body><div id="host"></div><script>
${PC_STATS_SOURCE.replace(/<\/script/gi, '<\\/script')}
var current = null, options = null;
function render() {
  if (!options || !innerWidth || !innerHeight) return;
  if (current) current.destroy();
  current = FreezeStats.mount(document.getElementById('host'), Object.assign({}, options, { width: innerWidth, height: innerHeight }));
}
window.freezeStatsUpdate = function (next) {
  options = next;
  render();
  window.ReactNativeWebView.postMessage(JSON.stringify({ needs: FreezeStats.needs(next.style, next.metric, next.columns, next.rows) }));
};
window.addEventListener('resize', render);
if (document.fonts) document.fonts.ready.then(render);
</script></body></html>`;

export function PcStatsWidget({ face, metric, color, gpu, columns, rows }: { face?: string; metric?: string; color?: string; gpu?: string; columns: number; rows: number }) {
  const webView = useRef<WebView>(null);
  const widget = useRef(nextWidget++);
  const [loaded, setLoaded] = useState(false);
  const options = JSON.stringify({ style: face ?? 'ring', metric: metric ?? 'cpu', color: color ?? null, gpu: gpu ?? 'auto', background: colors.panel, columns, rows });
  useEffect(() => {
    if (loaded) webView.current?.injectJavaScript(`window.freezeStatsUpdate(${options});true;`);
  }, [loaded, options]);
  // Leaving the screen (page change, widget removed) withdraws this widget's needs.
  useEffect(() => {
    const id = widget.current;
    return () => { needsByWidget.delete(id); publishNeeds(); };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const send = (sample: Sample | null) => {
      // Skip redraws while the app is in the background; the next sample after resuming catches up.
      if (AppState.currentState !== 'active') return;
      webView.current?.injectJavaScript(sample ? `FreezeStats.push(${JSON.stringify(sample)});true;` : `FreezeStats.setHistory(${JSON.stringify(history)});true;`);
    };
    send(null);
    listeners.add(send);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') send(null); });
    return () => { listeners.delete(send); subscription.remove(); };
  }, [loaded]);
  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const { needs } = JSON.parse(event.nativeEvent.data) as { needs?: unknown };
      if (validNeeds(needs)) { needsByWidget.set(widget.current, needs); publishNeeds(); }
    } catch { /* not a needs message */ }
  };
  return <View pointerEvents="none" style={styles.frame}>
    <WebView ref={webView} originWhitelist={['*']} source={{ html: HTML }} onLoadEnd={() => setLoaded(true)} onMessage={onMessage} textZoom={100} scrollEnabled={false} bounces={false} overScrollMode="never" showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} setSupportMultipleWindows={false} style={styles.webView} containerStyle={styles.webView} />
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, width: '100%', overflow: 'hidden', borderRadius: 6 },
  webView: { flex: 1, backgroundColor: 'transparent' },
});
