import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import type { SystemMediaState } from './connection';
import { activeLineAt, fetchLyrics, isGapLine, lyricLineOpacity, lyricsLayout, lyricsTrace, lyricsTrackKey, withIntroGap, type LyricLine, type Lyrics, type TimingVersion } from './lyrics';
import { Minus, Plus, RefreshCw } from 'lucide-react-native';
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

// Sync fixes the user made for a track: a timing version (named by when its first line is sung) and an
// offset, where a negative offset shows the lyrics later. Kept on the phone for the latest few hundred tracks.
type SyncChoice = { offsetMs: number; versionFirstMs?: number };
type StoredSyncChoice = SyncChoice & { at: number };
const SYNC_CHOICES_KEY = 'freeze.lyrics-sync';
const MAX_SYNC_CHOICES = 300;
const MAX_OFFSET_MS = 30_000;
const NUDGE_MS = 500;
// Matches TimingVersion grouping in lyrics.ts: versions this close are the same timing.
const SAME_VERSION_MS = 400;
const NO_CHOICE: SyncChoice = { offsetMs: 0 };
let syncChoices: Promise<Record<string, StoredSyncChoice>> | null = null;

function validChoice(value: unknown): value is StoredSyncChoice {
  if (!value || typeof value !== 'object') return false;
  const choice = value as Partial<StoredSyncChoice>;
  return typeof choice.offsetMs === 'number' && Number.isFinite(choice.offsetMs) && Math.abs(choice.offsetMs) <= MAX_OFFSET_MS &&
    (choice.versionFirstMs === undefined || (typeof choice.versionFirstMs === 'number' && Number.isFinite(choice.versionFirstMs))) &&
    typeof choice.at === 'number';
}

function loadSyncChoices() {
  syncChoices ??= Storage.getItem(SYNC_CHOICES_KEY).then((saved) => {
    const parsed: unknown = saved ? JSON.parse(saved) : {};
    const choices: Record<string, StoredSyncChoice> = {};
    if (parsed && typeof parsed === 'object') for (const [key, value] of Object.entries(parsed)) if (validChoice(value)) choices[key] = value;
    return choices;
  }).catch(() => ({}));
  return syncChoices;
}

async function saveSyncChoice(key: string, choice: SyncChoice) {
  const choices = await loadSyncChoices();
  if (choice.offsetMs !== 0 || choice.versionFirstMs !== undefined) choices[key] = { ...choice, at: Date.now() };
  else delete choices[key];
  const oldest = Object.entries(choices).sort((a, b) => b[1].at - a[1].at).slice(MAX_SYNC_CHOICES);
  for (const [stale] of oldest) delete choices[stale];
  await Storage.setItem(SYNC_CHOICES_KEY, JSON.stringify(choices)).catch(() => undefined);
}

// The saved sync fix for a track, and an updater that saves it. Updates build on the latest value,
// so a held nudge button keeps adding up.
function useSyncChoice(key: string | null) {
  const [loaded, setLoaded] = useState<{ key: string; choice: SyncChoice } | null>(null);
  const latest = useRef<{ key: string; choice: SyncChoice } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void loadSyncChoices().then((choices) => {
      // A nudge made while this loaded is newer than what was saved.
      if (!alive || latest.current?.key === key) return;
      const saved = choices[key];
      latest.current = { key, choice: saved ? { offsetMs: saved.offsetMs, versionFirstMs: saved.versionFirstMs } : NO_CHOICE };
      setLoaded(latest.current);
    });
    return () => { alive = false; };
  }, [key]);
  const update = useCallback((change: (current: SyncChoice) => SyncChoice) => {
    if (!key) return;
    const current = latest.current?.key === key ? latest.current.choice : NO_CHOICE;
    const next = change(current);
    const bounded = { ...next, offsetMs: clamp(next.offsetMs, -MAX_OFFSET_MS, MAX_OFFSET_MS) };
    latest.current = { key, choice: bounded };
    setLoaded(latest.current);
    // Saved once the taps stop, not on every step of a held button.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveSyncChoice(key, bounded), 600);
  }, [key]);
  // A pending save still happens when the track changes or the widget closes.
  useEffect(() => () => {
    if (!saveTimer.current || !latest.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void saveSyncChoice(latest.current.key, latest.current.choice);
  }, [key]);
  return [loaded?.key === key ? loaded.choice : NO_CHOICE, update] as const;
}

const signedSeconds = (milliseconds: number) => `${milliseconds > 0 ? '+' : milliseconds < 0 ? '−' : ''}${(Math.abs(milliseconds) / 1000).toFixed(1)} s`;
const firstSungMs = (lines: LyricLine[]) => lines.find((line) => !isGapLine(line))?.timeMs ?? 0;

// A tap steps once; holding keeps stepping until release. Only one repeat timer ever runs: a new hold
// clears any earlier one, so fast taps can't leave a timer stepping on its own.
function RepeatButton({ onStep, label, size, children }: { onStep: () => void; label: string; size: number; children: React.ReactNode }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  const hold = () => {
    stop();
    onStep();
    timer.current = setInterval(onStep, 150);
  };
  return <Pressable onPress={onStep} onLongPress={hold} delayLongPress={400} onPressOut={stop} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.syncButton, { width: size + 8, height: size + 8, opacity: pressed ? 0.9 : 0.45 }]}>
    {children}
  </Pressable>;
}

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

function SyncedLyrics({ lines, media, width, height, canSeek, seekMedia, onLongPress, offsetMs, onNudge }: { lines: LyricLine[]; media: SystemMediaState; width: number; height: number; canSeek: boolean; seekMedia: (positionMs: number) => boolean; onLongPress: () => void; offsetMs: number; onNudge: (deltaMs: number) => void }) {
  const reduceMotion = useReduceMotion();
  const { compact, fontSize, padding, lineGap, anchorY } = lyricsLayout(width, height);

  // Local clock: the last reported position plus the time since it arrived.
  // rate is 0 while paused or while the PC's player buffers, so the clock stands still with it.
  const anchor = useRef({ positionMs: 0, at: 0, rate: 0 });
  // The user's sync nudge for this track, added to the clock (negative shows lyrics later).
  const offset = useRef(offsetMs);
  const now = useCallback(() => anchor.current.positionMs + (performance.now() - anchor.current.at) * anchor.current.rate + LYRICS_LEAD_MS + offset.current, []);
  const snap = useRef(true);
  // Set by a nudge: the next move springs all lines together instead of the line-by-line wave.
  const glide = useRef(false);
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState(-1);
  const shownRef = useRef(-1);
  const playing = media.playbackState === 'playing';
  const rate = playing ? media.playbackRate ?? 1 : 0;

  // The latest report from the PC and when it arrived; the resync button snaps back to it.
  const reported = useRef<{ positionMs?: number; rate?: number; at: number }>({ at: 0 });

  // Re-anchors the clock on each position report, picks the current line, then sleeps until the next one starts.
  useEffect(() => {
    // A nudge glides the whole list together (no wave), and is never held back as jitter: fast taps
    // then just retarget the same smooth motion instead of jumping.
    const nudged = offset.current !== offsetMs;
    if (nudged) {
      offset.current = offsetMs;
      glide.current = true;
    }
    if (reported.current.positionMs !== media.positionMs || reported.current.rate !== rate) {
      reported.current = { positionMs: media.positionMs, rate, at: performance.now() };
      const positionMs = media.positionMs ?? 0;
      if (Math.abs(positionMs - (now() - LYRICS_LEAD_MS - offset.current)) > SEEK_JUMP_MS) snap.current = true;
      anchor.current = { positionMs, at: reported.current.at, rate };
    }
    const position = now();
    const computed = activeLineAt(lines, position);
    const current = shownRef.current;
    const keep = !snap.current && !nudged && computed < current && current < lines.length && position > lines[current].timeMs - JITTER_MS;
    const next = keep ? current : computed;
    // Same line after a re-anchor or nudge (e.g. a seek within it): nothing moves, so the snap or glide is spent here.
    if (next === current) {
      snap.current = false;
      glide.current = false;
    }
    shownRef.current = next;
    setShown(next);
    if (anchor.current.rate <= 0 || next + 1 >= lines.length) return;
    const timer = setTimeout(() => setTick((value) => value + 1), Math.max(0, lines[next + 1].timeMs - position) / anchor.current.rate + 5);
    return () => clearTimeout(timer);
  }, [lines, tick, now, media.positionMs, rate, offsetMs]);

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
        Animated.spring(line.y, { toValue: target, ...SPRING, delay: glide.current ? 0 : clamp(index - waveStart, 0, 12) * STAGGER_MS, useNativeDriver: true }).start();
      }
      const duration = snap.current || reduceMotion ? 200 : EMPHASIS_MS;
      Animated.timing(line.opacity, { toValue: opacity, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      Animated.timing(line.scale, { toValue: scale, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    });
    placedIndex.current = shown;
    snap.current = false;
    glide.current = false;
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

  const icon = clamp(fontSize * 0.6, 12, 18);
  const controlsWidth = 3 * (icon + 8) + 2 * 4;
  // Short blocks pin the active line to the top, under the sync buttons, so it keeps clear of them.
  return <View style={[styles.fill, { paddingLeft: padding, paddingRight: compact ? padding + controlsWidth + 4 : padding }]}>
    {lines.map((line, index) => {
      const gap = isGapLine(line);
      return <Animated.View key={`${index}:${line.timeMs}`} onLayout={(event) => measure(index, event.nativeEvent.layout.y)} style={{ marginBottom: lineGap, opacity: animated[index].opacity, transformOrigin: 'left center', transform: [{ translateY: animated[index].y }, { scale: animated[index].scale }] }}>
        <Pressable disabled={!canSeek || gap} onPress={() => seekTo(line)} onLongPress={onLongPress} accessibilityRole={canSeek && !gap ? 'button' : undefined} accessibilityLabel={gap ? 'Instrumental' : line.text}>
          {gap
            ? <GapDots size={fontSize * 0.42} active={index === shown} rate={rate} startMs={line.timeMs} endMs={lines[index + 1]?.timeMs ?? line.timeMs + NEUTRAL_GAP_MS} now={now} clock={`${media.positionMs}:${rate}:${tick}:${offsetMs}`} reduceMotion={reduceMotion} />
            : <Text allowFontScaling={false} style={[styles.line, { fontSize, lineHeight: fontSize * 1.25 }]}>{line.text}</Text>}
        </Pressable>
      </Animated.View>;
    })}
    {/* Earlier/later nudges around the resync button; the offset shows beneath them while set. */}
    <View style={[styles.syncControls, { top: padding * 0.5, right: padding * 0.5 }]}>
      <View style={styles.syncRow}>
        <RepeatButton onStep={() => onNudge(-NUDGE_MS)} label="Show lyrics half a second later" size={icon}>
          <Minus size={icon} color={colors.text} strokeWidth={2} />
        </RepeatButton>
        <Pressable onPress={resync} onLongPress={onLongPress} hitSlop={6} accessibilityRole="button" accessibilityLabel="Resync lyrics with the PC" style={({ pressed }) => [styles.syncButton, { width: icon + 8, height: icon + 8, opacity: pressed ? 0.9 : 0.45 }]}>
          <RefreshCw size={icon} color={colors.text} strokeWidth={2} />
        </Pressable>
        <RepeatButton onStep={() => onNudge(NUDGE_MS)} label="Show lyrics half a second earlier" size={icon}>
          <Plus size={icon} color={colors.text} strokeWidth={2} />
        </RepeatButton>
      </View>
      {offsetMs !== 0 ? <Text allowFontScaling={false} accessibilityLabel={`Lyrics offset ${signedSeconds(offsetMs)}`} style={[styles.offsetLabel, { fontSize: icon * 0.75 }]}>{signedSeconds(offsetMs)}</Text> : null}
    </View>
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
  const [choice, updateChoice] = useSyncChoice(key);
  const versions = useMemo(() => lyrics !== 'loading' && (lyrics.kind === 'synced' || lyrics.kind === 'plain') ? lyrics.versions ?? [] : [], [lyrics]);
  const autoFirstMs = lyrics !== 'loading' && lyrics.kind === 'synced' ? firstSungMs(lyrics.lines) : undefined;
  // A timing version the user picked wins over the automatic one, even over lyrics shown unsynced.
  const picked = choice.versionFirstMs === undefined ? undefined : versions.find((version) => Math.abs(version.firstMs - (choice.versionFirstMs ?? 0)) <= SAME_VERSION_MS);
  const chosenLines = picked?.lines ?? (lyrics !== 'loading' && lyrics.kind === 'synced' ? lyrics.lines : null);
  const lines = useMemo(() => chosenLines ? withIntroGap(chosenLines) : null, [chosenLines]);
  const nudge = useCallback((deltaMs: number) => updateChoice((current) => ({ ...current, offsetMs: current.offsetMs + deltaMs })), [updateChoice]);
  const pickVersion = useCallback((firstMs: number | undefined) => updateChoice((current) => ({ ...current, versionFirstMs: firstMs })), [updateChoice]);
  const resetOffset = useCallback(() => updateChoice((current) => ({ ...current, offsetMs: 0 })), [updateChoice]);
  const width = size.width || 92;
  const height = size.height || 92;
  const { messageSize } = lyricsLayout(width, height);
  const hasMedia = connected && media.playbackState !== 'unavailable' && Boolean(media.title || media.artist);
  const canSeek = connected && Boolean(media.canSeek);

  let content;
  if (!hasMedia) content = <Message title="Nothing playing" size={messageSize} />;
  else if (lyrics === 'loading') content = <BreathingDots size={messageSize * 0.5} labelSize={messageSize} />;
  // Keyed by track and timing version, so a new song or timing mounts fresh: no scroll from the old position.
  else if (lines) content = <SyncedLyrics key={`${key}:${picked?.firstMs ?? 'auto'}`} lines={lines} media={media} width={width} height={height} canSeek={canSeek} seekMedia={seekMedia} onLongPress={showDebug} offsetMs={choice.offsetMs} onNudge={nudge} />;
  else if (lyrics.kind === 'plain') content = <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: messageSize }}>
    {versions.length > 0 ? <Text allowFontScaling={false} style={[styles.plainHint, { fontSize: messageSize * 0.8 }]}>Not synced to this video · long-press to pick a timing</Text> : null}
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
    {debug ? <LyricsDebug media={media} status={lyrics === 'loading' ? 'loading' : lyrics.kind} onClose={() => setDebug(false)}
      sync={{ versions, shownFirstMs: picked?.firstMs ?? autoFirstMs, autoFirstMs, reason: lyrics !== 'loading' && lyrics.kind === 'synced' ? lyrics.reason : undefined, picked: picked !== undefined, offsetMs: choice.offsetMs }}
      onPickVersion={pickVersion} onResetOffset={resetOffset} /> : null}
  </View>;
}

const durationLabel = (milliseconds?: number) => milliseconds === undefined ? 'not reported' : `${(milliseconds / 1000).toFixed(1)} s`;

// What the PC reported for the track and each lookup step, refreshed while a lookup is still running.
type SyncPanel = { versions: TimingVersion[]; shownFirstMs?: number; autoFirstMs?: number; reason?: string; picked: boolean; offsetMs: number };

// The sync fixes, then what the PC reported for the track and each lookup step, refreshed while a lookup
// is still running. Tapping a timing version uses it for this track from now on.
function LyricsDebug({ media, status, onClose, sync, onPickVersion, onResetOffset }: { media: SystemMediaState; status: string; onClose: () => void; sync: SyncPanel; onPickVersion: (firstMs: number | undefined) => void; onResetOffset: () => void }) {
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
  const same = (a?: number, b?: number) => a !== undefined && b !== undefined && Math.abs(a - b) <= SAME_VERSION_MS;
  return <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close lyrics details" style={styles.debug}>
    <ScrollView nestedScrollEnabled contentContainerStyle={styles.debugContent}>
      <Text allowFontScaling={false} style={styles.debugHeading}>Sync</Text>
      <View style={styles.debugRow}>
        <Text allowFontScaling={false} style={styles.debugText}>offset: {sync.offsetMs === 0 ? 'none' : `${signedSeconds(sync.offsetMs)} (${sync.offsetMs < 0 ? 'lyrics later' : 'lyrics earlier'})`}</Text>
        {sync.offsetMs !== 0 ? <Pressable onPress={onResetOffset} hitSlop={6} accessibilityRole="button" accessibilityLabel="Reset the lyrics offset" style={styles.debugChip}><Text allowFontScaling={false} style={styles.debugChipText}>Reset</Text></Pressable> : null}
      </View>
      {sync.versions.length > 0 ? <>
        <Text allowFontScaling={false} style={styles.debugText}>timings found ({sync.picked ? 'picked by you' : sync.autoFirstMs === undefined ? 'none used: the lengths differ, so shown unsynced' : sync.reason ? `automatic: ${sync.reason}` : 'automatic'}):</Text>
        {sync.versions.map((version) => {
          const shown = same(version.firstMs, sync.shownFirstMs);
          return <Pressable key={version.firstMs} onPress={() => onPickVersion(version.firstMs)} accessibilityRole="button" accessibilityState={{ selected: shown }} accessibilityLabel={`Use the timing starting at ${(version.firstMs / 1000).toFixed(1)} seconds`} style={[styles.debugChip, shown && styles.debugChipSelected]}>
            <Text allowFontScaling={false} style={styles.debugChipText}>{shown ? '✓ ' : ''}starts {(version.firstMs / 1000).toFixed(1)} s · {version.entries} {version.entries === 1 ? 'entry' : 'entries'}{same(version.firstMs, sync.autoFirstMs) ? ' · automatic' : ''}</Text>
          </Pressable>;
        })}
        {sync.picked ? <Pressable onPress={() => onPickVersion(undefined)} accessibilityRole="button" accessibilityLabel="Go back to the automatic timing" style={styles.debugChip}><Text allowFontScaling={false} style={styles.debugChipText}>Back to automatic</Text></Pressable> : null}
      </> : null}
      <Text allowFontScaling={false} style={styles.debugHeading}>Details</Text>
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
  syncControls: { position: 'absolute', alignItems: 'flex-end', gap: 2 },
  syncRow: { flexDirection: 'row', gap: 4 },
  syncButton: { alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: 'rgba(24, 24, 27, 0.7)' },
  offsetLabel: { color: colors.muted, fontWeight: '600', paddingHorizontal: 4, borderRadius: 6, backgroundColor: 'rgba(24, 24, 27, 0.7)', overflow: 'hidden' },
  debug: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(9, 9, 11, 0.95)' },
  debugContent: { padding: 10, gap: 4 },
  debugText: { color: colors.text, fontSize: 11, lineHeight: 15, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  debugHint: { color: colors.faint, fontSize: 11, marginTop: 6 },
  debugHeading: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 4, textTransform: 'uppercase' },
  debugRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  debugChip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelRaised },
  debugChipSelected: { borderColor: colors.accent },
  debugChipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  plainHint: { color: colors.faint, fontWeight: '600', marginBottom: 8 },
});
