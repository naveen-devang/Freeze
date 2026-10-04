import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// Development-only battery check: what the app does each second. Start Metro with
// EXPO_PUBLIC_PERF_OVERLAY=1 to show it; release builds never include it.
export const PERF_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_PERF_OVERLAY === '1';

const counts = { messages: new Map<string, number>(), renders: new Map<string, number>(), wakes: new Map<string, number>() };
const bump = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

/** A message from the PC, by type. */
export function countMessage(type: string) { if (PERF_ENABLED) bump(counts.messages, type); }
/** A render of a named component. */
export function countRender(name: string) { if (PERF_ENABLED) bump(counts.renders, name); }
/** Wake-ups (animation frames and timers) a web widget reported for the last period. */
export function countWakes(widget: string, wakes: number) { if (PERF_ENABLED) bump(counts.wakes, widget, wakes); }

/** JavaScript for a widget page: counts its own animation frames and timers and posts them every 2 s. */
export const WAKE_COUNTER_JS = PERF_ENABLED ? `(function () {
  var n = 0, raf = window.requestAnimationFrame, timeout = window.setTimeout;
  window.requestAnimationFrame = function (f) { n++; return raf.call(window, f); };
  window.setTimeout = function (f, ms) { n++; return timeout.call(window, f, ms); };
  setInterval(function () { window.ReactNativeWebView.postMessage(JSON.stringify({ wakes: n })); n = 0; }, 2000);
})();` : '';

export function PerfOverlay() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    if (!PERF_ENABLED) return;
    let last = Date.now();
    const interval = setInterval(() => {
      const now = Date.now(), seconds = (now - last) / 1000;
      last = now;
      const rate = (map: Map<string, number>) => [...map].map(([key, value]) => `${key} ${(value / seconds).toFixed(1)}`).join(' · ') || 'none';
      setLines([`msgs/s: ${rate(counts.messages)}`, `renders/s: ${rate(counts.renders)}`, `web wakes/s: ${rate(counts.wakes)}`]);
      counts.messages.clear(); counts.renders.clear(); counts.wakes.clear();
    }, 2000);
    return () => clearInterval(interval);
  }, []);
  if (!PERF_ENABLED) return null;
  return <View pointerEvents="none" style={styles.box}>{lines.map((line) => <Text key={line} allowFontScaling={false} style={styles.text}>{line}</Text>)}</View>;
}

const styles = StyleSheet.create({
  box: { position: 'absolute', left: 8, bottom: 8, padding: 6, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 100 },
  text: { color: '#4ade80', fontSize: 10, fontFamily: 'monospace' },
});
