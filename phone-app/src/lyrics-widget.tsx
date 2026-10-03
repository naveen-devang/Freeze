import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SystemMediaState } from './connection';
import { activeLineAt, fetchLyrics, isGapLine, lyricLineOpacity, lyricsLayout, lyricsTrace, lyricsTrackKey, withIntroGap, type LyricLine, type Lyrics } from './lyrics';
import { RefreshCw } from 'lucide-react-native';
import { colors } from './theme';

// ponytail: one fixed lead for every setup; make it a setting if lines feel early or late on some PCs.
const LYRICS_LEAD_MS = 250;
// Backward corrections smaller than this keep the current line, so the highlight never flickers back.
const JITTER_MS = 400;
// A position jump bigger than this is a seek: the list snaps instead of scrolling.
const SEEK_JUMP_MS = 1500;
const STAGGER_MS = 40;
const SPRING = { stiffness: 140, damping: 22, mass: 1 };
const EMPHASIS_MS = 450;
const DOT_BREATH_MS = 1000;
const DOT_EXIT_MS = 300;
const NEUTRAL_GAP_MS = 4000;
// Players publish a new title before its other details, so the lookup waits for them to settle.
const SETTLE_MS = 700;
// Some players publish the duration late or never: wait this long for it, then look up by name alone.
const MISSING_DURATION_WAIT_MS = 1500;
// While a song keeps playing, a failed lookup is tried again this often.
const ERROR_RETRY_MS = 15_000;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (alive) setReduce(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

// A gentle 1 -> 1.08 -> 1 pulse, used by every set of dots.
function useBreath(enabled: boolean) {
  const [breath] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!enabled) {
      breath.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: DOT_BREATH_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breath, { toValue: 0, duration: DOT_BREATH_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [breath, enabled]);
  return breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
}

function Dots({ size, opacities, scale }: { size: number; opacities: (Animated.AnimatedInterpolation<number> | number)[]; scale: Animated.AnimatedInterpolation<number> | Animated.AnimatedMultiplication<number> | number }) {
  return <Animated.View style={[styles.dots, { height: size * 2.6, gap: size * 0.7, transform: [{ scale }] }]}>
    {opacities.map((opacity, index) => <Animated.View key={index} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.text, opacity }} />)}
  </Animated.View>;
}

// Instrumental gap: the three dots fill in across the gap, breathe, and shrink away just before the next line.
function GapDots({ size, active, rate, startMs, endMs, now, clock, reduceMotion }: { size: number; active: boolean; rate: number; startMs: number; endMs: number; now: () => number; clock: string; reduceMotion: boolean }) {
  const [progress] = useState(() => new Animated.Value(0));
  const span = Math.max(1, endMs - startMs);
  useEffect(() => {
    if (!active) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }
    const start = clamp((now() - startMs) / span, 0, 1);
    progress.setValue(start);
    if (rate <= 0 || start >= 1) return;
    const fill = Animated.timing(progress, { toValue: 1, duration: (1 - start) * span / rate, easing: Easing.linear, useNativeDriver: true });
    fill.start();
    return () => fill.stop();
  }, [active, rate, progress, span, startMs, now, clock]);
  const breath = useBreath(active && rate > 0 && !reduceMotion);
  const exitStart = Math.max(0, 1 - DOT_EXIT_MS / span);
  const exit = progress.interpolate({ inputRange: [0, exitStart, 1], outputRange: [1, 1, 0], extrapolate: 'clamp' });
  const opacities = [0, 1, 2].map((index) => active ? progress.interpolate({ inputRange: [index / 3, (index + 1) / 3], outputRange: [0.3, 1], extrapolate: 'clamp' }) : 0.3);
  return <Dots size={size} opacities={opacities} scale={active ? Animated.multiply(breath, exit) : 1} />;
}

function SyncedLyrics({ lines, media, width, height, canSeek, seekMedia, onLongPress }: { lines: LyricLine[]; media: SystemMediaState; width: number; height: number; canSeek: boolean; seekMedia: (positionMs: number) => boolean; onLongPress: () => void }) {
  const reduceMotion = useReduceMotion();
  const { compact, fontSize, padding, lineGap, anchorY } = lyricsLayout(width, height);

  // Local clock: the last reported position plus the time since it arrived.
  // rate is 0 while paused or while the PC's player buffers, so the clock stands still with it.
  const anchor = useRef({ positionMs: 0, at: 0, rate: 0 });
  const now = useCallback(() => anchor.current.positionMs + (performance.now() - anchor.current.at) * anchor.current.rate + LYRICS_LEAD_MS, []);
  const snap = useRef(true);
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState(-1);
  const shownRef = useRef(-1);
  const playing = media.playbackState === 'playing';
  const rate = playing ? media.playbackRate ?? 1 : 0;

  // The latest report from the PC and when it arrived; the resync button snaps back to it.
  const reported = useRef<{ positionMs?: number; rate?: number; at: number }>({ at: 0 });

  // Re-anchors the clock on each position report, picks the current line, then sleeps until the next one starts.
  useEffect(() => {
    if (reported.current.positionMs !== media.positionMs || reported.current.rate !== rate) {
      reported.current = { positionMs: media.positionMs, rate, at: performance.now() };
      const positionMs = media.positionMs ?? 0;
      if (Math.abs(positionMs - (now() - LYRICS_LEAD_MS)) > SEEK_JUMP_MS) snap.current = true;
      anchor.current = { positionMs, at: reported.current.at, rate };
    }
    const position = now();
    const computed = activeLineAt(lines, position);
    const current = shownRef.current;
    const keep = !snap.current && computed < current && current < lines.length && position > lines[current].timeMs - JITTER_MS;
    const next = keep ? current : computed;
    // Same line after a re-anchor (e.g. a seek within it): nothing moves, so the snap is spent here.
    if (next === current) snap.current = false;
    shownRef.current = next;
    setShown(next);
    if (anchor.current.rate <= 0 || next + 1 >= lines.length) return;
    const timer = setTimeout(() => setTick((value) => value + 1), Math.max(0, lines[next + 1].timeMs - position) / anchor.current.rate + 5);
    return () => clearTimeout(timer);
  }, [lines, tick, now, media.positionMs, rate]);

  const animated = useMemo(() => lines.map(() => ({ y: new Animated.Value(0), opacity: new Animated.Value(0.15), scale: new Animated.Value(0.96) })), [lines]);
  const offsets = useRef<number[]>([]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const placedIndex = useRef<number | null>(null);

  // Moves every line so the active one sits at the anchor, in a downward-travelling wave.
  useEffect(() => {
    for (let index = 0; index < lines.length; index += 1) if (offsets.current[index] === undefined) return;
    const anchorIndex = Math.max(0, shown);
    const target = anchorY - offsets.current[anchorIndex];
    const previous = placedIndex.current;
    const instant = snap.current || previous === null || previous === shown || reduceMotion;
    const waveStart = previous === null ? shown : Math.min(previous, shown);
    animated.forEach((line, index) => {
      const distance = shown < 0 ? index + 1 : Math.abs(index - shown);
      const opacity = compact && index < shown ? 0 : lyricLineOpacity(distance);
      const scale = reduceMotion || index === shown ? 1 : 0.96;
      if (instant) {
        line.y.stopAnimation();
        line.y.setValue(target);
      } else {
        Animated.spring(line.y, { toValue: target, ...SPRING, delay: clamp(index - waveStart, 0, 12) * STAGGER_MS, useNativeDriver: true }).start();
      }
      const duration = snap.current || reduceMotion ? 200 : EMPHASIS_MS;
      Animated.timing(line.opacity, { toValue: opacity, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      Animated.timing(line.scale, { toValue: scale, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    });
    placedIndex.current = shown;
    snap.current = false;
  }, [animated, shown, layoutVersion, anchorY, compact, reduceMotion, lines.length]);

  const seekTo = useCallback((line: LyricLine) => {
    if (!seekMedia(line.timeMs)) return;
    anchor.current = { positionMs: line.timeMs, at: performance.now(), rate: anchor.current.rate };
    setTick((value) => value + 1);
  }, [seekMedia]);
  // Back to exactly what the PC last reported, jumping straight to that line.
  const resync = useCallback(() => {
    anchor.current = { positionMs: reported.current.positionMs ?? 0, at: reported.current.at, rate: reported.current.rate ?? 0 };
    snap.current = true;
    setTick((value) => value + 1);
  }, []);
  const measure = useCallback((index: number, y: number) => {
    if (offsets.current[index] === y) return;
    offsets.current[index] = y;
    setLayoutVersion((value) => value + 1);
  }, []);

  const resyncIcon = clamp(fontSize * 0.6, 12, 18);
  // Short blocks pin the active line to the top, under the resync button, so it keeps clear of it.
  return <View style={[styles.fill, { paddingLeft: padding, paddingRight: compact ? padding + resyncIcon + 8 : padding }]}>
    {lines.map((line, index) => {
      const gap = isGapLine(line);
      return <Animated.View key={`${index}:${line.timeMs}`} onLayout={(event) => measure(index, event.nativeEvent.layout.y)} style={{ marginBottom: lineGap, opacity: animated[index].opacity, transformOrigin: 'left center', transform: [{ translateY: animated[index].y }, { scale: animated[index].scale }] }}>
        <Pressable disabled={!canSeek || gap} onPress={() => seekTo(line)} onLongPress={onLongPress} accessibilityRole={canSeek && !gap ? 'button' : undefined} accessibilityLabel={gap ? 'Instrumental' : line.text}>
          {gap
            ? <GapDots size={fontSize * 0.42} active={index === shown} rate={rate} startMs={line.timeMs} endMs={lines[index + 1]?.timeMs ?? line.timeMs + NEUTRAL_GAP_MS} now={now} clock={`${media.positionMs}:${rate}:${tick}`} reduceMotion={reduceMotion} />
            : <Text allowFontScaling={false} style={[styles.line, { fontSize, lineHeight: fontSize * 1.25 }]}>{line.text}</Text>}
        </Pressable>
      </Animated.View>;
    })}
    <Pressable onPress={resync} onLongPress={onLongPress} hitSlop={10} accessibilityRole="button" accessibilityLabel="Resync lyrics with the PC" style={({ pressed }) => [styles.resync, { top: padding * 0.5, right: padding * 0.5, opacity: pressed ? 0.9 : 0.45 }]}>
      <RefreshCw size={resyncIcon} color={colors.text} strokeWidth={2} />
    </Pressable>
  </View>;
}

function Message({ title, size }: { title: string; size: number }) {
  return <View style={styles.center}><Text allowFontScaling={false} numberOfLines={2} style={[styles.message, { fontSize: size }]}>{title}</Text></View>;
}

function BreathingDots({ size, label, labelSize }: { size: number; label?: string; labelSize: number }) {
  const reduceMotion = useReduceMotion();
  const breath = useBreath(!reduceMotion);
  return <View style={styles.center}>
    <Dots size={size} opacities={[1, 1, 1]} scale={breath} />
    {label ? <Text allowFontScaling={false} style={[styles.message, { fontSize: labelSize }]}>{label}</Text> : null}
  </View>;
}

export function LyricsWidget({ media, connected, seekMedia }: { media: SystemMediaState; connected: boolean; seekMedia: (positionMs: number) => boolean }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const key = lyricsTrackKey(media);
  const [result, setResult] = useState<{ key: string; lyrics: Lyrics } | null>(null);
  const [retry, setRetry] = useState(0);
  const [debug, setDebug] = useState(false);
  // Waits for the track details to settle (longer while the duration is missing), then looks it up.
  // A duration arriving later changes the key, which restarts the wait and looks up again with it.
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const track = { title: media.title, artist: media.artist, album: media.album, durationMs: media.durationMs };
    const timer = setTimeout(() => {
      void fetchLyrics(track).then((lyrics) => {
        if (alive) setResult({ key, lyrics });
      });
    }, media.durationMs ? SETTLE_MS : MISSING_DURATION_WAIT_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, retry, media.title, media.artist, media.album, media.durationMs]);
  // Lyrics belong to one track: anything fetched for another key is never shown.
  const lyrics = useMemo((): Lyrics | 'loading' => !key ? { kind: 'none' } : result?.key === key ? result.lyrics : 'loading', [key, result]);
  useEffect(() => {
    if (lyrics === 'loading' || lyrics.kind !== 'error') return;
    const timer = setTimeout(() => setRetry((value) => value + 1), ERROR_RETRY_MS);
    return () => clearTimeout(timer);
  }, [lyrics]);
  const showDebug = useCallback(() => setDebug(true), []);
  const lines = useMemo(() => lyrics !== 'loading' && lyrics.kind === 'synced' ? withIntroGap(lyrics.lines) : null, [lyrics]);
  const width = size.width || 92;
  const height = size.height || 92;
  const { messageSize } = lyricsLayout(width, height);
  const hasMedia = connected && media.playbackState !== 'unavailable' && Boolean(media.title || media.artist);
  const canSeek = connected && Boolean(media.canSeek);

  let content;
  if (!hasMedia) content = <Message title="Nothing playing" size={messageSize} />;
  else if (lyrics === 'loading') content = <BreathingDots size={messageSize * 0.5} labelSize={messageSize} />;
  // Keyed by track, so a new song mounts fresh: no scroll from the old song's position.
  else if (lines) content = <SyncedLyrics key={key} lines={lines} media={media} width={width} height={height} canSeek={canSeek} seekMedia={seekMedia} onLongPress={showDebug} />;
  else if (lyrics.kind === 'plain') content = <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: messageSize }}>
    <Text allowFontScaling={false} style={[styles.plain, { fontSize: messageSize * 1.05, lineHeight: messageSize * 1.55 }]}>{lyrics.text}</Text>
  </ScrollView>;
  else if (lyrics.kind === 'instrumental') content = <BreathingDots size={messageSize * 0.5} label="Instrumental" labelSize={messageSize} />;
  else content = <Message title={lyrics.kind === 'error' ? 'Lyrics unavailable' : 'No lyrics found'} size={messageSize} />;

  return <View onLayout={(event) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
    setSize((current) => Math.abs(current.width - nextWidth) < 1 && Math.abs(current.height - nextHeight) < 1 ? current : { width: nextWidth, height: nextHeight });
  }} style={styles.widget}>
    {/* Long-press anywhere for what the PC reported and what the lookup tried. */}
    <Pressable onLongPress={showDebug} delayLongPress={600} accessibilityHint="Long press for lyrics lookup details" style={styles.fill}>
      {size.height ? content : null}
    </Pressable>
    {debug ? <LyricsDebug media={media} status={lyrics === 'loading' ? 'loading' : lyrics.kind} onClose={() => setDebug(false)} /> : null}
  </View>;
}

const durationLabel = (milliseconds?: number) => milliseconds === undefined ? 'not reported' : `${(milliseconds / 1000).toFixed(1)} s`;

// What the PC reported for the track and each lookup step, refreshed while a lookup is still running.
function LyricsDebug({ media, status, onClose }: { media: SystemMediaState; status: string; onClose: () => void }) {
  const [, setRefresh] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setRefresh((value) => value + 1), 500);
    return () => clearInterval(interval);
  }, []);
  const trace = lyricsTrace(media);
  const rows = [
    `title: ${media.title ?? '(none)'}`,
    `artist: ${media.artist ?? '(none)'}`,
    `album: ${media.album ?? '(none)'}`,
    `duration: ${durationLabel(media.durationMs)}`,
    `player: ${media.sourceAppId ?? 'unknown'} (${media.playbackState})`,
    `lyrics: ${status}`,
    trace.key ? '' : 'lookup skipped: no title, or shorter than 30 s / longer than 15 min',
    ...trace.steps,
  ].filter(Boolean);
  return <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close lyrics details" style={styles.debug}>
    <ScrollView nestedScrollEnabled contentContainerStyle={styles.debugContent}>
      {rows.map((row, index) => <Text key={index} allowFontScaling={false} selectable style={styles.debugText}>{row}</Text>)}
      <Text allowFontScaling={false} style={styles.debugHint}>Tap to close</Text>
    </ScrollView>
  </Pressable>;
}

const styles = StyleSheet.create({
  widget: { flex: 1, width: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', borderRadius: 6 },
  fill: { flex: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 },
  message: { color: colors.muted, fontWeight: '600', textAlign: 'center' },
  line: { color: colors.text, fontWeight: '700', textAlign: 'left' },
  plain: { color: colors.text, opacity: 0.85, fontWeight: '600' },
  dots: { flexDirection: 'row', alignItems: 'center' },
  resync: { position: 'absolute', padding: 4, borderRadius: 999, backgroundColor: 'rgba(24, 24, 27, 0.7)' },
  debug: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(9, 9, 11, 0.95)' },
  debugContent: { padding: 10, gap: 4 },
  debugText: { color: colors.text, fontSize: 11, lineHeight: 15, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  debugHint: { color: colors.faint, fontSize: 11, marginTop: 6 },
});
