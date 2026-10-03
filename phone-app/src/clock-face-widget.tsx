import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useCalendars } from 'expo-localization';
import { CLOCK_FACES_SOURCE } from './clock-faces-source';

// The faces are shared web code (pc-companion/src/clock-faces/clock-faces.js), so the phone runs
// them in a WebView. The page re-mounts the face whenever its options or size change.
// ponytail: fonts come from Google Fonts and fall back to system fonts offline; bundle them if offline looks matter.
const HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@500;600&family=Barlow+Condensed:wght@600&display=swap">
<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}#host{width:100vw;height:100vh}</style>
</head><body><div id="host"></div><script>
${CLOCK_FACES_SOURCE.replace(/<\/script/gi, '<\\/script')}
FreezeClock.setFrameRate(30);
var current = null, options = null;
function render() {
  if (!options || !innerWidth || !innerHeight) return;
  if (current) current.destroy();
  current = FreezeClock.mount(document.getElementById('host'), Object.assign({}, options, { width: innerWidth, height: innerHeight }));
}
window.freezeClockUpdate = function (next) { options = next; render(); };
window.addEventListener('resize', render);
if (document.fonts) document.fonts.ready.then(render);
</script></body></html>`;

export function ClockFaceWidget({ face, color }: { face?: string; color?: string }) {
  const webView = useRef<WebView>(null);
  const [loaded, setLoaded] = useState(false);
  const [{ uses24hourClock }] = useCalendars();
  const options = JSON.stringify({ face: face ?? 'digital', color: color ?? null, hour12: uses24hourClock !== true });
  useEffect(() => {
    if (loaded) webView.current?.injectJavaScript(`window.freezeClockUpdate(${options});true;`);
  }, [loaded, options]);
  // Stop animating while the app is in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => webView.current?.injectJavaScript(`FreezeClock.setPaused(${state !== 'active'});true;`));
    return () => subscription.remove();
  }, []);
  return <View pointerEvents="none" style={styles.frame}>
    <WebView ref={webView} originWhitelist={['*']} source={{ html: HTML }} onLoadEnd={() => setLoaded(true)} scrollEnabled={false} bounces={false} overScrollMode="never" showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} setSupportMultipleWindows={false} style={styles.webView} containerStyle={styles.webView} />
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, width: '100%', overflow: 'hidden', borderRadius: 6 },
  webView: { flex: 1, backgroundColor: 'transparent' },
});
