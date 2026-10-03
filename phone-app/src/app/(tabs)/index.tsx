import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { BackHandler, Image, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppWindow, ChevronRight, Clock, Command, File, FolderOpen, Headphones, Keyboard, Layers2, ListOrdered, Maximize2, Mic, Minimize2, Monitor, Music, Package, PanelsTopLeft, Pause, Play, SkipBack, SkipForward, Snowflake, Volume1, Volume2, VolumeX, Wifi } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { NavigationBar } from 'expo-navigation-bar';
import { useCalendars } from 'expo-localization';
import { SvgXml } from 'react-native-svg';
import { DeckButton, DeckMediaCommand, DeckWidget, PlaybackState, SystemMediaState, usePcConnection } from '../../connection';
import { buttonPlacement, deckOccupancy, widgetPageOccupancy, WidgetScreenItem } from '../../deck-layout';
import { colors } from '../../theme';
import { TabBarHiddenContext } from '../../navigation/tab-bar-context';

const shortcutIcons: Record<string, typeof Command> = {
  command: Command,
  monitor: Monitor,
  music: Music,
  mic: Mic,
  headphones: Headphones,
  'app-window': AppWindow,
};

function controlIcon(button: DeckButton, playback: PlaybackState) {
  const { action } = button;
  if (button.icon !== 'auto' && !button.appIconData) return shortcutIcons[button.icon] ?? Command;
  if (action.type === 'media') {
    const media: Record<DeckMediaCommand, typeof Command> = {
      previous_track: SkipBack,
      play_pause: playback === 'playing' ? Pause : Play,
      next_track: SkipForward,
      volume_down: Volume1,
      volume_up: Volume2,
      mute: VolumeX,
    };
    return media[action.command];
  }
  if (action.type === 'launch_app') return AppWindow;
  if (action.type === 'launch_file') return File;
  if (action.type === 'launch_folder') return FolderOpen;
  if (action.type === 'run_script') return File;
  if (action.type === 'plugin_action') return Package;
  if (action.type === 'sequence') return ListOrdered;
  if (action.type === 'select_profile') return Layers2;
  if (action.type === 'select_page') return PanelsTopLeft;
  return Keyboard;
}

function ClockWidget({ immersive = false }: { immersive?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const [{ uses24hourClock }] = useCalendars();
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const contentWidth = contentSize.width || 92;
  const contentHeight = contentSize.height || 92;
  const compact = contentSize.width > 0 && contentWidth < 90;
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: uses24hourClock == null ? undefined : !uses24hourClock });
  const timeSize = Math.max(8, Math.min(31, contentWidth * 0.92 / (time.length * 0.66), contentHeight * (immersive ? 0.46 : 0.34)));
  const dateSize = Math.max(7, Math.min(10, contentHeight * (immersive ? 0.2 : 0.15)));
  const iconSize = Math.max(8, Math.min(18, contentHeight * 0.17));
  const gap = Math.min(immersive ? 6 : 4, contentHeight * (immersive ? 0.07 : 0.04));
  return <View onLayout={(event) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
    setContentSize((size) => Math.abs(size.width - nextWidth) < 1 && Math.abs(size.height - nextHeight) < 1 ? size : { width: nextWidth, height: nextHeight });
  }} style={[styles.clockWidgetContent, immersive && styles.immersiveClockContent, { gap }]}>
    {immersive ? null : <Clock size={iconSize} color={colors.muted} strokeWidth={1.7} />}
    <Text allowFontScaling={false} numberOfLines={1} style={[styles.clockWidgetTime, { fontSize: timeSize, lineHeight: timeSize * 1.08 }]}>{time}</Text>
    <Text allowFontScaling={false} numberOfLines={1} style={[styles.clockWidgetDate, { fontSize: dateSize, lineHeight: dateSize * 1.15 }]}>{now.toLocaleDateString([], compact ? { month: 'numeric', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
  </View>;
}

function PluginTextWidget({ widget, immersive = false }: { widget: Extract<DeckWidget, { type: 'plugin' }>; immersive?: boolean }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const title = widget.values.title?.trim() ?? '';
  const body = widget.values.body?.trim() ?? '';
  const contentHeight = Math.max(20, (size.height || 84) - 12);
  const charsPerLine = Math.max(8, Math.floor((size.width || 92) / 8));
  const titleLines = title ? Math.min(2, Math.ceil(title.length / charsPerLine)) : 0;
  const bodyLines = body ? Math.min(6, Math.ceil(body.length / charsPerLine)) : 0;
  const lineHeight = Math.max(9, (contentHeight - (titleLines && bodyLines ? 4 : 0)) / Math.max(1, titleLines + bodyLines));
  const titleSize = Math.max(8, Math.min(24, (size.width || 92) * 0.09, lineHeight / 1.12));
  const bodySize = Math.max(7, Math.min(17, (size.width || 92) * 0.065, lineHeight / 1.2));
  if (widget.renderType !== 'text') return <View style={styles.pluginWidgetContent}><Package size={20} color={colors.muted} /><Text style={styles.pluginWidgetUnavailable}>Widget unavailable</Text></View>;
  return <View onLayout={(event) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width, height });
  }} style={[styles.pluginWidgetContent, immersive && styles.immersivePluginWidgetContent]}>
    {title ? <Text allowFontScaling={false} numberOfLines={2} adjustsFontSizeToFit style={[styles.pluginWidgetTitle, { fontSize: titleSize, lineHeight: titleSize * 1.12 }]}>{title}</Text> : null}
    {body ? <Text allowFontScaling={false} numberOfLines={immersive ? 4 : 6} adjustsFontSizeToFit style={[styles.pluginWidgetBody, { fontSize: bodySize, lineHeight: bodySize * 1.2 }]}>{body}</Text> : null}
    {!title && !body ? <Text style={styles.pluginWidgetUnavailable}>Text widget</Text> : null}
  </View>;
}

function mediaTimeLabel(milliseconds: number | undefined) {
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return '--:--';
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function SystemVolumeSlider({ value, disabled, onChange }: { value?: number; disabled: boolean; onChange: (value: number) => boolean }) {
  const [width, setWidth] = useState(1);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragValueRef = useRef<number | null>(null);
  const currentValue = dragValue ?? value ?? 0;
  useEffect(() => {
    if (dragValue === null) return;
    const timeout = setTimeout(() => setDragValue((current) => current === dragValue ? null : current), value === dragValue ? 0 : 1500);
    return () => clearTimeout(timeout);
  }, [dragValue, value]);
  const updateFromEvent = useCallback((locationX: number) => {
    const next = Math.round(Math.max(0, Math.min(1, locationX / width)) * 100);
    dragValueRef.current = next;
    setDragValue(next);
  }, [width]);
  // PanResponder runs these callbacks for native gestures, after render; the ref
  // preserves the latest touch value until its release callback commits it.
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: (event) => updateFromEvent(event.nativeEvent.locationX),
    onPanResponderMove: (event) => updateFromEvent(event.nativeEvent.locationX),
    onPanResponderRelease: () => {
      const next = dragValueRef.current;
      dragValueRef.current = null;
      if (next !== null) {
        setDragValue(next);
        if (!onChange(next)) setDragValue(null);
      }
    },
    onPanResponderTerminate: () => {
      dragValueRef.current = null;
      setDragValue(null);
    },
  }), [disabled, onChange, updateFromEvent]);
  return <View style={[styles.nowPlayingVolume, disabled && styles.nowPlayingVolumeDisabled]}>
    <Volume1 size={17} color={colors.muted} strokeWidth={1.8} />
    <View accessibilityRole="adjustable" accessibilityLabel="System volume" accessibilityValue={{ min: 0, max: 100, now: currentValue }} onAccessibilityAction={(event) => {
      const next = Math.max(0, Math.min(100, currentValue + (event.nativeEvent.actionName === 'increment' ? 5 : -5)));
      setDragValue(null);
      onChange(next);
    }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))} {...responder.panHandlers} style={styles.nowPlayingVolumeTrack}>
      <View pointerEvents="none" style={styles.nowPlayingVolumeRail}><View style={[styles.nowPlayingVolumeFill, { width: `${currentValue}%` }]} /></View>
      <View pointerEvents="none" style={[styles.nowPlayingVolumeThumb, { left: `${currentValue}%` }]} />
    </View>
    <Volume2 size={17} color={colors.muted} strokeWidth={1.8} />
    <Text style={styles.nowPlayingVolumeLabel}>{value === undefined ? '—' : `${currentValue}%`}</Text>
  </View>;
}

function NowPlayingWidget({ media, immersive = false, connected, sendCommand, sendVolume }: { media: SystemMediaState; immersive?: boolean; rowSpan: number; columnSpan: number; connected: boolean; sendCommand: (command: DeckMediaCommand) => boolean; sendVolume: (volumePercent: number) => boolean }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const width = size.width || 92;
  const height = size.height || 92;
  // Choose the presentation from the space the native view actually receives.
  // Grid spans alone are not reliable: a 2x2 block on a phone can be smaller
  // than a 1x2 block on a tablet, and immersive mode has a different cell size.
  const compact = width < 116 || height < 88;
  const stacked = !compact && height > width * 1.2;
  const horizontal = !compact && !stacked;
  const standard = !compact && width >= 190 && height >= (stacked ? 205 : 128);
  const expanded = standard && width >= (stacked ? 185 : 310) && height >= (stacked ? 310 : 190);
  const showTimeline = height >= 100 && width >= 112;
  const hasTrack = Boolean(media.title || media.artist || media.album);
  const supportingText = media.artist || media.album || (media.playbackState === 'unavailable' ? 'Waiting for media' : media.playbackState === 'paused' ? 'Paused' : 'System media');
  const artCap = compact ? 34 : expanded ? (horizontal ? 420 : 280) : standard ? (horizontal ? 58 : 46) : (horizontal ? 42 : 36);
  const artSize = Math.max(compact ? 20 : 24, Math.min(artCap, height * (expanded ? (horizontal ? 0.58 : 0.3) : horizontal ? 0.42 : 0.22), width * (expanded ? (horizontal ? 0.32 : 0.5) : horizontal ? 0.24 : 0.42)));
  const titleSize = Math.max(10, Math.min(expanded ? 34 : 17, width * (compact ? 0.105 : 0.055), height * (compact ? 0.16 : 0.11)));
  const detailSize = Math.max(8, Math.min(expanded ? 16 : 11, width * 0.032, height * 0.075));
  const duration = media.durationMs && media.durationMs > 0 ? media.durationMs : 0;
  const currentPosition = duration ? Math.max(0, Math.min(duration, media.positionMs ?? 0)) : Math.max(0, media.positionMs ?? 0);
  const progress = duration ? currentPosition / duration : 0;
  const controlItems: { command: DeckMediaCommand; icon: typeof SkipBack; label: string; prominent?: boolean }[] = [
    { command: 'previous_track', icon: SkipBack, label: 'Previous track' },
    { command: 'play_pause', icon: media.playbackState === 'playing' ? Pause : Play, label: media.playbackState === 'playing' ? 'Pause' : 'Play', prominent: true },
    { command: 'next_track', icon: SkipForward, label: 'Next track' },
  ];
  return <View onLayout={(event) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
    setSize((current) => Math.abs(current.width - nextWidth) < 1 && Math.abs(current.height - nextHeight) < 1 ? current : { width: nextWidth, height: nextHeight });
  }} style={[styles.nowPlayingWidget, immersive && styles.immersiveNowPlayingWidget, horizontal && styles.nowPlayingHorizontal, stacked && styles.nowPlayingStacked, expanded && styles.nowPlayingExpanded]}>
    {expanded && media.artworkDataUrl ? <>
      <View pointerEvents="none" style={styles.nowPlayingBackdropFrame}><Image source={{ uri: media.artworkDataUrl }} style={styles.nowPlayingBackdrop} blurRadius={24} resizeMode="cover" /></View>
      <View pointerEvents="none" style={styles.nowPlayingBackdropTint} />
    </> : null}
    {media.artworkDataUrl ? <Image source={{ uri: media.artworkDataUrl }} style={[styles.nowPlayingArtwork, { width: artSize, height: artSize, borderRadius: Math.max(5, artSize * 0.13) }]} resizeMode="cover" /> : <View style={[styles.nowPlayingFallback, { width: artSize, height: artSize, borderRadius: Math.max(5, artSize * 0.13) }]}><Music size={Math.max(12, artSize * 0.43)} color="#93c5fd" strokeWidth={1.7} /></View>}
    {compact ? <View style={styles.nowPlayingCompactCopy}>
      <Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit style={[styles.nowPlayingTitle, { fontSize: titleSize, lineHeight: titleSize * 1.15 }]}>{hasTrack ? media.title || media.artist || media.album : 'No media'}</Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.nowPlayingDetail, horizontal && styles.nowPlayingHorizontalText, { fontSize: detailSize }]}>{supportingText}</Text>
      {duration > 0 && showTimeline ? <View style={styles.nowPlayingTimeline}>
        <View style={[styles.nowPlayingProgressTrack, expanded && styles.nowPlayingExpandedProgressTrack]}><View style={[styles.nowPlayingProgress, { width: `${progress * 100}%` }]} /></View>
        <View style={styles.nowPlayingTimeLabels}><Text allowFontScaling={false} style={[styles.nowPlayingAlbum, styles.nowPlayingTimeLabel, { fontSize: detailSize * 0.72 }]}>{mediaTimeLabel(currentPosition)}</Text><Text allowFontScaling={false} style={[styles.nowPlayingAlbum, styles.nowPlayingTimeLabel, { fontSize: detailSize * 0.72 }]}>{mediaTimeLabel(duration)}</Text></View>
      </View> : null}
    </View> : <View style={[styles.nowPlayingPanel, horizontal && styles.nowPlayingHorizontalCopy]}>
      <View style={[styles.nowPlayingCopy, horizontal && styles.nowPlayingHorizontalCopy]}>
        <Text allowFontScaling={false} numberOfLines={expanded ? 2 : 1} adjustsFontSizeToFit style={[styles.nowPlayingTitle, horizontal && styles.nowPlayingHorizontalText, { fontSize: titleSize, lineHeight: titleSize * 1.15 }]}>{hasTrack ? media.title || media.artist || media.album : 'No media'}</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.nowPlayingDetail, horizontal && styles.nowPlayingHorizontalText, { fontSize: detailSize }]}>{supportingText}</Text>
        {expanded && media.album ? <Text allowFontScaling={false} numberOfLines={1} style={[styles.nowPlayingAlbum, horizontal && styles.nowPlayingHorizontalText, { fontSize: detailSize * 0.92 }]}>{media.album}</Text> : null}
      </View>
      {duration > 0 && showTimeline ? <View style={styles.nowPlayingTimeline}>
        <View style={[styles.nowPlayingProgressTrack, expanded && styles.nowPlayingExpandedProgressTrack]}><View style={[styles.nowPlayingProgress, { width: `${progress * 100}%` }]} /></View>
        <View style={styles.nowPlayingTimeLabels}><Text allowFontScaling={false} style={[styles.nowPlayingAlbum, styles.nowPlayingTimeLabel, { fontSize: detailSize * 0.78 }]}>{mediaTimeLabel(currentPosition)}</Text><Text allowFontScaling={false} style={[styles.nowPlayingAlbum, styles.nowPlayingTimeLabel, { fontSize: detailSize * 0.78 }]}>{mediaTimeLabel(duration)}</Text></View>
      </View> : null}
      {standard ? <View style={[styles.nowPlayingControls, expanded && styles.nowPlayingExpandedControls, stacked && styles.nowPlayingStackedControls]}>
        {controlItems.map(({ command, icon: Icon, label, prominent }) => <Pressable key={command} onPress={() => sendCommand(command)} disabled={!connected} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.nowPlayingControl, prominent && styles.nowPlayingPrimaryControl, pressed && connected && styles.nowPlayingControlPressed, !connected && styles.nowPlayingControlDisabled]}>
          <Icon size={prominent ? (expanded ? 24 : 19) : (expanded ? 18 : 15)} color={prominent ? colors.text : colors.muted} strokeWidth={1.8} />
        </Pressable>)}
      </View> : null}
      {expanded ? <SystemVolumeSlider value={media.volumePercent} disabled={!connected || media.volumePercent === undefined} onChange={sendVolume} /> : null}
    </View>}
  </View>;
}

export default function DeckScreen() {
  const router = useRouter();
  const setTabBarHidden = useContext(TabBarHiddenContext);
  const { connection, status, playbackState, mediaState, actionError, deckConfig, independentNavigation, selectedProfileId, selectedPageId, sendButton, sendMediaCommand, sendSystemVolume, selectPage } = usePcConnection();
  const [feedback, setFeedback] = useState('');
  const [immersive, setImmersive] = useState(false);
  const [showImmersiveTools, setShowImmersiveTools] = useState(false);
  const [immersiveSize, setImmersiveSize] = useState({ width: 0, height: 0 });
  const [widgetPageIndices, setWidgetPageIndices] = useState<Record<string, number>>({});
  const [regularGridWidth, setRegularGridWidth] = useState(0);
  const [widgetGridWidth, setWidgetGridWidth] = useState(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const immersiveToolsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeProfile = deckConfig?.profiles.find((profile) => profile.id === (independentNavigation ? selectedProfileId : deckConfig.activeProfileId));
  const activePage = activeProfile?.pages.find((page) => page.id === (independentNavigation ? selectedPageId : activeProfile.activePageId));
  const activePageIndex = activeProfile?.pages.findIndex((page) => page.id === activePage?.id) ?? -1;
  const widgetArea = activePage?.widgetArea;
  const widgetPageIndex = Math.min(widgetPageIndices[`${activeProfile?.id}:${activePage?.id}`] ?? 0, Math.max(0, (widgetArea?.pages.length ?? 1) - 1));
  const widgetScreen = widgetArea?.pages[widgetPageIndex];
  const hasWidgetArea = !!widgetArea?.enabled;

  useEffect(() => () => {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const setOrientation = async () => {
      try {
        await ScreenOrientation.lockAsync(immersive
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } catch {
        if (alive && immersive) {
          setImmersive(false);
          setFeedback('Landscape mode is unavailable on this device');
        }
      }
    };
    void setOrientation();
    return () => { alive = false; };
  }, [immersive]);

  useEffect(() => {
    setTabBarHidden(immersive);
    return () => setTabBarHidden(false);
  }, [immersive, setTabBarHidden]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setHidden(immersive);
    return () => NavigationBar.setHidden(false);
  }, [immersive]);

  useEffect(() => {
    if (!immersive) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setImmersive(false);
      setShowImmersiveTools(false);
      return true;
    });
    return () => subscription.remove();
  }, [immersive]);

  useEffect(() => () => {
    if (immersiveToolsTimer.current) clearTimeout(immersiveToolsTimer.current);
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  const revealImmersiveTools = () => {
    setShowImmersiveTools(true);
    if (immersiveToolsTimer.current) clearTimeout(immersiveToolsTimer.current);
    immersiveToolsTimer.current = setTimeout(() => {
      immersiveToolsTimer.current = null;
      setShowImmersiveTools(false);
    }, 2800);
  };

  const pageSwipeResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 38 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
    onPanResponderRelease: (_, gesture) => {
      const pages = activeProfile?.pages ?? [];
      if (pages.length < 2 || activePageIndex < 0) return;
      const nextIndex = (activePageIndex + (gesture.dx < 0 ? 1 : -1) + pages.length) % pages.length;
      selectPage(pages[nextIndex].id);
    },
  });
  const widgetSwipeResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 32 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
    onPanResponderRelease: (_, gesture) => {
      const count = widgetArea?.pages.length ?? 0;
      if (count < 2) return;
      const key = `${activeProfile?.id}:${activePage?.id}`;
      setWidgetPageIndices((current) => ({ ...current, [key]: (widgetPageIndex + (gesture.dx < 0 ? 1 : -1) + count) % count }));
    },
  });

  const connected = status === 'connected';
  const isPlaying = playbackState === 'playing';
  const columns = activePage?.columns ?? 3;
  const rows = activePage?.rows ?? Math.max(1, Math.ceil((activePage?.buttons.length ?? 0) / columns));
  const hasButtons = !!activePage?.buttons.length;
  const occupied = activePage ? deckOccupancy(activePage) : new Map<number, DeckButton>();
  const widgetColumns = widgetArea?.columns ?? 3;
  const widgetRows = widgetArea?.rows ?? 2;
  const widgetOccupied = widgetArea && widgetScreen ? widgetPageOccupancy(widgetArea, widgetScreen) : new Map<number, WidgetScreenItem>();
  // A page with no buttons is a widget-only page even if its saved grid
  // dimensions were left non-zero by an older desktop editor build.
  const widgetOnlyMode = !hasButtons && hasWidgetArea;
  const showWidgetArea = hasWidgetArea && (widgetOnlyMode || widgetOccupied.size > 0);
  const widgetPlacements = widgetScreen ? [
    ...widgetScreen.buttons.map((button) => buttonPlacement({ id: widgetScreen.id, name: widgetScreen.name, rows: widgetRows, columns: widgetColumns, buttons: widgetScreen.buttons }, button)),
    ...widgetScreen.widgets.map((widget) => widget.placement),
  ] : [];
  const widgetTopRow = widgetOnlyMode && widgetPlacements.length ? Math.min(...widgetPlacements.map((placement) => placement.row)) : 0;
  const widgetLeftColumn = widgetOnlyMode && widgetPlacements.length ? Math.min(...widgetPlacements.map((placement) => placement.column)) : 0;
  const displayWidgetRows = widgetOnlyMode && widgetPlacements.length
    ? Math.max(...widgetPlacements.map((placement) => placement.row + placement.rowSpan)) - widgetTopRow
    : widgetRows;
  const displayWidgetColumns = widgetOnlyMode && widgetPlacements.length
    ? Math.max(...widgetPlacements.map((placement) => placement.column + placement.columnSpan)) - widgetLeftColumn
    : widgetColumns;
  const regularGap = 9;
  const regularCellWidth = Math.max(0, (regularGridWidth - regularGap * (Math.max(1, columns) - 1)) / Math.max(1, columns));
  const widgetCellWidth = Math.max(0, (widgetGridWidth - regularGap * (Math.max(1, displayWidgetColumns) - 1)) / Math.max(1, displayWidgetColumns));
  const immersiveGap = 10;
  const immersiveAvailableHeight = Math.max(0, immersiveSize.height - 24);
  const buttonImmersiveHeight = hasButtons ? immersiveAvailableHeight * (showWidgetArea ? rows / (rows + widgetRows) : 1) : 0;
  const widgetImmersiveHeight = showWidgetArea ? immersiveAvailableHeight - buttonImmersiveHeight : 0;
  const immersiveCellWidth = Math.max(0, (immersiveSize.width - 24 - immersiveGap * (columns - 1)) / columns);
  const immersiveCellHeight = Math.max(1, (buttonImmersiveHeight - 24 - immersiveGap * (rows - 1)) / rows);
  const immersiveWidgetCellWidth = Math.max(0, (immersiveSize.width - 24 - immersiveGap * (displayWidgetColumns - 1)) / displayWidgetColumns);
  const immersiveWidgetCellHeight = Math.max(1, (widgetImmersiveHeight - 24 - immersiveGap * (displayWidgetRows - 1)) / displayWidgetRows);
  const immersiveIconSize = Math.min(52, Math.max(26, Math.min(immersiveCellHeight, immersiveCellWidth) * 0.34));
  const immersiveWidgetIconSize = Math.min(52, Math.max(20, Math.min(immersiveWidgetCellHeight, immersiveWidgetCellWidth) * 0.34));
  const actionErrorText = actionError === 'accessibility_permission_required' ? 'Allow Freeze in Mac Accessibility settings'
    : actionError === 'app_launch_failed' ? 'PC could not launch this app. Check its target path'
    : actionError === 'stale_revision' ? 'Deck changed. Wait for sync, then try again'
    : actionError === 'unknown_button' ? 'Button is out of date. Refresh the deck and try again'
    : actionError ? 'PC could not perform control' : '';

  const press = (button: DeckButton, label: string) => {
    if (!connected) {
      router.push('/connect');
      return;
    }
    if (sendButton(button.id)) {
      setFeedback(`${label} sent`);
      if (feedbackTimer.current) {
        clearTimeout(feedbackTimer.current);
      }
      feedbackTimer.current = setTimeout(() => {
        feedbackTimer.current = null;
        setFeedback('');
      }, 1600);
    } else {
      setFeedback('PC connection lost');
    }
  };

  const enterImmersive = async () => {
    try {
      const supported = await ScreenOrientation.supportsOrientationLockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      if (!supported) {
        setFeedback('Landscape mode is unavailable on this device');
        return;
      }
      setImmersive(true);
    } catch {
      setFeedback('Could not switch to landscape mode');
    }
  };

  const cellFrame = (row: number, column: number, rowSpan = 1, columnSpan = 1, cellWidth = regularCellWidth, cellHeight = 100, gap = regularGap, inset = 0, offsetY = 0) => ({
    position: 'absolute' as const,
    left: inset + column * (cellWidth + gap),
    top: offsetY + inset + row * (cellHeight + gap),
    width: cellWidth * columnSpan + gap * (columnSpan - 1),
    height: cellHeight * rowSpan + gap * (rowSpan - 1),
  });

  if (immersive) {
    return <>
      <StatusBar hidden style="light" />
      <SafeAreaView style={styles.immersiveSafe} edges={['top', 'right', 'bottom', 'left']} onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setImmersiveSize((current) => current.width === width && current.height === height ? current : { width, height });
      }}>
        <Pressable style={styles.immersiveBackdrop} onPress={revealImmersiveTools} accessibilityLabel="Deck background. Tap for controls" />
        <View style={styles.immersiveGrid} pointerEvents="box-none">
          {activePage && hasButtons ? <View style={[styles.immersiveDeckCanvas, { top: 12, height: buttonImmersiveHeight }]} {...pageSwipeResponder.panHandlers}>
          {Array.from({ length: rows * columns }, (_, index) => {
            const row = Math.floor(index / columns);
            const column = index % columns;
            const item = occupied.get(index);
            if (!item) return <Pressable key={`empty-${index}`} onPress={revealImmersiveTools} style={[styles.immersiveEmptyKey, cellFrame(row, column, 1, 1, immersiveCellWidth, immersiveCellHeight, immersiveGap, 12)]} accessibilityLabel="Empty deck slot. Tap to show deck controls" />;
            const button = item as DeckButton;
            const placement = buttonPlacement(activePage!, button);
            if (placement.row !== row || placement.column !== column) return null;
            const dynamicPlay = button.icon === 'auto' && button.action.type === 'media' && button.action.command === 'play_pause';
            const label = dynamicPlay ? (isPlaying ? 'Pause' : 'Play') : button.label;
            const Icon = controlIcon(button, playbackState);
            return <Pressable key={button.id} style={({ pressed }) => [styles.immersiveKey, cellFrame(placement.row, placement.column, placement.rowSpan, placement.columnSpan, immersiveCellWidth, immersiveCellHeight, immersiveGap, 12), pressed && styles.keyPressed, !connected && styles.keyDisabled]} onPress={() => press(button, label)} disabled={!connected} accessibilityRole="button" accessibilityLabel={label}>
              {button.appIconData ? <Image source={{ uri: button.appIconData }} style={{ width: immersiveIconSize, height: immersiveIconSize }} resizeMode="contain" /> : button.iconSvg && button.icon !== 'auto' ? <SvgXml xml={button.iconSvg} width={immersiveIconSize} height={immersiveIconSize} /> : <Icon size={immersiveIconSize} color={colors.text} strokeWidth={1.7} />}
            </Pressable>;
          })}
          </View> : null}
          {showWidgetArea && widgetArea && widgetScreen ? <View style={[styles.immersiveWidgetCanvas, { top: widgetOnlyMode ? 12 : 12 + buttonImmersiveHeight, height: widgetImmersiveHeight }]} {...widgetSwipeResponder.panHandlers}>
            {Array.from({ length: displayWidgetRows * displayWidgetColumns }, (_, index) => {
              const row = Math.floor(index / displayWidgetColumns);
              const column = index % displayWidgetColumns;
              const sourceRow = row + widgetTopRow;
              const sourceColumn = column + widgetLeftColumn;
              const item = widgetOccupied.get(sourceRow * widgetColumns + sourceColumn);
              if (!item) return null;
              if (item.type === 'widget') {
                const placement = item.widget.placement;
                if (placement.row !== sourceRow || placement.column !== sourceColumn) return null;
                return <View key={item.widget.id} style={[styles.immersiveKey, styles.clockWidgetKey, cellFrame(placement.row - widgetTopRow, placement.column - widgetLeftColumn, placement.rowSpan, placement.columnSpan, immersiveWidgetCellWidth, immersiveWidgetCellHeight, immersiveGap, 12, 0)]}>{item.widget.type === 'clock' ? <ClockWidget immersive /> : item.widget.type === 'now_playing' ? <NowPlayingWidget media={mediaState} immersive rowSpan={placement.rowSpan} columnSpan={placement.columnSpan} connected={connected} sendCommand={sendMediaCommand} sendVolume={sendSystemVolume} /> : <PluginTextWidget widget={item.widget} immersive />}</View>;
              }
              const button = item.button;
              const placement = buttonPlacement({ id: widgetScreen.id, name: widgetScreen.name, rows: widgetRows, columns: widgetColumns, buttons: widgetScreen.buttons }, button);
              if (placement.row !== sourceRow || placement.column !== sourceColumn) return null;
              const label = button.icon === 'auto' && button.action.type === 'media' && button.action.command === 'play_pause' ? (isPlaying ? 'Pause' : 'Play') : button.label;
              const Icon = controlIcon(button, playbackState);
              return <Pressable key={button.id} style={({ pressed }) => [styles.immersiveKey, cellFrame(placement.row - widgetTopRow, placement.column - widgetLeftColumn, placement.rowSpan, placement.columnSpan, immersiveWidgetCellWidth, immersiveWidgetCellHeight, immersiveGap, 12), pressed && styles.keyPressed, !connected && styles.keyDisabled]} onPress={() => press(button, label)} disabled={!connected} accessibilityRole="button" accessibilityLabel={label}>
                {button.appIconData ? <Image source={{ uri: button.appIconData }} style={{ width: immersiveWidgetIconSize, height: immersiveWidgetIconSize }} resizeMode="contain" /> : button.iconSvg && button.icon !== 'auto' ? <SvgXml xml={button.iconSvg} width={immersiveWidgetIconSize} height={immersiveWidgetIconSize} /> : <Icon size={immersiveWidgetIconSize} color={colors.text} strokeWidth={1.7} />}
              </Pressable>;
            })}
            {(widgetArea.pages.length > 1) ? <View style={styles.immersiveWidgetPageIndicator} pointerEvents="none"><Text style={styles.pageTabText}>{widgetPageIndex + 1} / {widgetArea.pages.length}</Text></View> : null}
          </View> : null}
        </View>
        {showImmersiveTools ? <View style={styles.immersiveTools}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.immersivePageTools}>
            {(activeProfile?.pages ?? []).map((page, index) => <Pressable key={page.id} onPress={() => { selectPage(page.id); revealImmersiveTools(); }} style={[styles.immersivePageButton, index === activePageIndex && styles.pageTabActive]} accessibilityRole="button" accessibilityLabel={`Show ${page.name} page`} accessibilityState={{ selected: index === activePageIndex }}>
              <Text style={[styles.pageTabText, index === activePageIndex && styles.pageTabTextActive]}>{page.name}</Text>
            </Pressable>)}
          </ScrollView>
          <Pressable style={styles.immersiveExit} onPress={() => { setImmersive(false); setShowImmersiveTools(false); }} accessibilityRole="button" accessibilityLabel="Exit immersive mode"><Minimize2 size={19} color={colors.text} /></Pressable>
        </View> : null}
      </SafeAreaView>
    </>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={[styles.content, widgetOnlyMode && styles.widgetOnlyContent]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brand}><Snowflake size={19} color={colors.text} strokeWidth={1.8} /><Text style={styles.brandName}>Freeze</Text></View>
          <View style={styles.headerActions}>
          <Pressable style={styles.immersiveToggle} onPress={() => void enterImmersive()} accessibilityRole="button" accessibilityLabel="Enter immersive landscape deck"><Maximize2 size={17} color={colors.muted} /></Pressable>
          <Pressable style={styles.connectionPill} onPress={() => router.push('/connect')} accessibilityRole="button" accessibilityLabel={`PC ${connected ? 'connected' : 'disconnected'}. Open connection settings`}>
            <View style={[styles.dot, connected ? styles.dotOnline : styles.dotOffline]} />
            <Text style={styles.connectionText} numberOfLines={1}>{connected ? (connection?.deviceName ?? 'Connected') : 'Connect PC'}</Text>
            <ChevronRight size={14} color={colors.faint} />
          </Pressable>
          </View>
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title}>Deck</Text>
          <View style={styles.subtitleRow}>
            <Text style={styles.subtitle}>{activeProfile?.name ?? (deckConfig ? 'No active profile' : 'Waiting for PC deck')}</Text>
          </View>
        </View>

        {activeProfile ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pageTabs}>
          {activeProfile.pages.map((page) => <Pressable key={page.id} style={[styles.pageTab, page.id === activePage?.id && styles.pageTabActive]} onPress={() => selectPage(page.id)} accessibilityRole="button" accessibilityState={{ selected: page.id === activePage?.id }}>
              <Text style={[styles.pageTabText, page.id === activePage?.id && styles.pageTabTextActive]}>{page.name}</Text>
          </Pressable>)}
        </ScrollView> : null}

        {!connected && <Pressable style={styles.connectBanner} onPress={() => router.push('/connect')} accessibilityRole="button">
          <Monitor size={18} color={colors.muted} />
          <View style={styles.bannerCopy}><Text style={styles.bannerTitle}>Connect your PC</Text><Text style={styles.bannerSub}>Scan the QR code in Freeze for desktop</Text></View>
          <ChevronRight size={16} color={colors.faint} />
        </Pressable>}

        {activePage && hasButtons ? <>
          <Text style={styles.sectionTitle}>{activePage.name}</Text>
          <View style={[styles.grid, { height: rows * 100 + Math.max(0, rows - 1) * regularGap }]} onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            setRegularGridWidth((current) => Math.abs(current - width) < 0.5 ? current : width);
          }} {...pageSwipeResponder.panHandlers}>
            {Array.from({ length: rows * columns }, (_, index) => {
              const row = Math.floor(index / columns);
              const column = index % columns;
              const item = occupied.get(index);
              if (!item) return <View key={`empty-${index}`} style={[styles.key, styles.emptyKey, cellFrame(row, column)]} />;
              const button = item as DeckButton;
              const placement = buttonPlacement(activePage!, button);
              if (placement.row !== row || placement.column !== column) return null;
              const dynamicPlay = button.icon === 'auto' && button.action.type === 'media' && button.action.command === 'play_pause';
              const label = dynamicPlay ? (isPlaying ? 'Pause' : 'Play') : button.label;
              const Icon = controlIcon(button, playbackState);
              return <Pressable key={button.id} style={({ pressed }) => [styles.key, cellFrame(placement.row, placement.column, placement.rowSpan, placement.columnSpan), pressed && styles.keyPressed, !connected && styles.keyDisabled]} onPress={() => press(button, label)} disabled={!connected} accessibilityRole="button" accessibilityLabel={label}>
                {button.appIconData ? <Image source={{ uri: button.appIconData }} style={styles.appIcon} resizeMode="contain" /> : button.iconSvg && button.icon !== 'auto' ? <SvgXml xml={button.iconSvg} width={21} height={21} /> : <Icon size={21} color={colors.text} strokeWidth={1.7} />}
                <Text style={styles.keyLabel} numberOfLines={2}>{label}</Text>
              </Pressable>;
            })}
          </View>
        </> : !widgetOnlyMode ? <View style={styles.emptyDeck}><Command size={20} color={colors.faint} /><Text style={styles.feedbackText}>{connected ? 'The desktop has no active deck page.' : 'Connect to a PC to load its deck.'}</Text></View> : null}

        {showWidgetArea && widgetArea && widgetScreen ? <View style={[styles.widgetArea, widgetOnlyMode && styles.widgetOnlyArea]} {...widgetSwipeResponder.panHandlers}>
          <View style={styles.widgetAreaHeading}><Text style={styles.widgetAreaTitle}>Widgets</Text>{widgetArea.pages.length > 1 ? <Text style={styles.widgetAreaPage}>{widgetPageIndex + 1} / {widgetArea.pages.length}</Text> : null}</View>
          {widgetOccupied.size === 0 ? <View pointerEvents="none" style={styles.widgetOnlyEmpty}><Command size={20} color={colors.faint} /><Text style={styles.feedbackText}>Add widgets to this page in the desktop editor.</Text></View> : null}
          <View style={[styles.grid, { height: displayWidgetRows * 100 + Math.max(0, displayWidgetRows - 1) * regularGap }]} onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            setWidgetGridWidth((current) => Math.abs(current - width) < 0.5 ? current : width);
          }}>
            {Array.from({ length: displayWidgetRows * displayWidgetColumns }, (_, index) => {
              const row = Math.floor(index / displayWidgetColumns);
              const column = index % displayWidgetColumns;
              const sourceRow = row + widgetTopRow;
              const sourceColumn = column + widgetLeftColumn;
              const item = widgetOccupied.get(sourceRow * widgetColumns + sourceColumn);
              const widgetCellHeight = 100;
              if (!item) return <View key={`widget-empty-${index}`} style={[styles.key, styles.emptyKey, cellFrame(row, column, 1, 1, widgetCellWidth, widgetCellHeight)]} />;
              if (item.type === 'widget') {
                const placement = item.widget.placement;
                if (placement.row !== sourceRow || placement.column !== sourceColumn) return null;
                return <View key={item.widget.id} style={[styles.key, styles.clockWidgetKey, cellFrame(placement.row - widgetTopRow, placement.column - widgetLeftColumn, placement.rowSpan, placement.columnSpan, widgetCellWidth, widgetCellHeight)]}>{item.widget.type === 'clock' ? <ClockWidget /> : item.widget.type === 'now_playing' ? <NowPlayingWidget media={mediaState} rowSpan={placement.rowSpan} columnSpan={placement.columnSpan} connected={connected} sendCommand={sendMediaCommand} sendVolume={sendSystemVolume} /> : <PluginTextWidget widget={item.widget} />}</View>;
              }
              const button = item.button;
              const placement = buttonPlacement({ id: widgetScreen.id, name: widgetScreen.name, rows: widgetRows, columns: widgetColumns, buttons: widgetScreen.buttons }, button);
              if (placement.row !== sourceRow || placement.column !== sourceColumn) return null;
              const label = button.icon === 'auto' && button.action.type === 'media' && button.action.command === 'play_pause' ? (isPlaying ? 'Pause' : 'Play') : button.label;
              const Icon = controlIcon(button, playbackState);
              return <Pressable key={button.id} style={({ pressed }) => [styles.key, cellFrame(placement.row - widgetTopRow, placement.column - widgetLeftColumn, placement.rowSpan, placement.columnSpan, widgetCellWidth, widgetCellHeight), pressed && styles.keyPressed, !connected && styles.keyDisabled]} onPress={() => press(button, label)} disabled={!connected} accessibilityRole="button" accessibilityLabel={label}>
                {button.appIconData ? <Image source={{ uri: button.appIconData }} style={styles.appIcon} resizeMode="contain" /> : button.iconSvg && button.icon !== 'auto' ? <SvgXml xml={button.iconSvg} width={21} height={21} /> : <Icon size={21} color={colors.text} strokeWidth={1.7} />}
                <Text style={styles.keyLabel} numberOfLines={2}>{label}</Text>
              </Pressable>;
            })}
          </View>
        </View> : null}

        <View style={styles.feedbackRow}>
          {actionError ? <><Wifi size={13} color={colors.faint} /><Text style={styles.feedbackText}>{actionErrorText}</Text></> : feedback ? <><View style={styles.feedbackDot} /><Text style={styles.feedbackText}>{feedback}</Text></> : <><Wifi size={13} color={colors.faint} /><Text style={styles.feedbackText}>{connected ? 'Ready to send controls' : 'Connect to enable controls'}</Text></>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  immersiveSafe: { flex: 1, backgroundColor: colors.bg },
  immersiveBackdrop: { ...StyleSheet.absoluteFill },
  immersiveGrid: { ...StyleSheet.absoluteFill },
  immersiveDeckCanvas: { position: 'absolute', left: 0, right: 0 },
  immersiveWidgetCanvas: { position: 'absolute', left: 0, right: 0 },
  immersiveWidgetPageIndicator: { position: 'absolute', top: 0, right: 12, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: colors.panel },
  immersiveKey: { borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  clockWidgetKey: { padding: 4, alignItems: 'center', justifyContent: 'center' },
  clockWidgetContent: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 4 },
  immersiveClockContent: { gap: 6 },
  clockWidgetTime: { width: '100%', color: colors.text, fontSize: 21, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'center', includeFontPadding: false },
  clockWidgetDate: { width: '100%', color: colors.muted, fontSize: 10, textAlign: 'center', includeFontPadding: false },
  pluginWidgetContent: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 3, overflow: 'hidden' },
  immersivePluginWidgetContent: { gap: 7, paddingHorizontal: 8 },
  pluginWidgetTitle: { width: '100%', flexShrink: 1, color: colors.text, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  pluginWidgetBody: { width: '100%', flexShrink: 1, color: colors.muted, textAlign: 'center', includeFontPadding: false },
  pluginWidgetUnavailable: { color: colors.muted, fontSize: 10, textAlign: 'center' },
  nowPlayingWidget: { flex: 1, width: '100%', minWidth: 0, minHeight: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, padding: 4, overflow: 'hidden' },
  immersiveNowPlayingWidget: { padding: 7, gap: 8 },
  nowPlayingExpanded: { gap: 10 },
  nowPlayingBackdropFrame: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  nowPlayingBackdrop: { ...StyleSheet.absoluteFill, opacity: 0.3 },
  nowPlayingBackdropTint: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(9, 9, 11, 0.78)' },
  nowPlayingHorizontal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 8, padding: 6 },
  nowPlayingStacked: { justifyContent: 'center', gap: 7, paddingHorizontal: 8, paddingVertical: 8 },
  nowPlayingArtwork: { flexShrink: 0, backgroundColor: colors.panelRaised },
  nowPlayingFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.border },
  nowPlayingCompactCopy: { flex: 1, width: '100%', minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2, overflow: 'hidden' },
  nowPlayingPanel: { flex: 1, width: '100%', minWidth: 0, minHeight: 0, alignItems: 'center', justifyContent: 'center', gap: 4, overflow: 'hidden' },
  nowPlayingCopy: { width: '100%', minWidth: 0, minHeight: 0, alignItems: 'center', justifyContent: 'center', gap: 2, overflow: 'hidden' },
  nowPlayingHorizontalCopy: { alignItems: 'flex-start' },
  nowPlayingHorizontalText: { textAlign: 'left' },
  nowPlayingTitle: { width: '100%', flexShrink: 1, color: colors.text, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  nowPlayingDetail: { width: '100%', color: colors.muted, textAlign: 'center', includeFontPadding: false },
  nowPlayingAlbum: { width: '100%', color: colors.faint, textAlign: 'center', includeFontPadding: false },
  nowPlayingTimeline: { width: '100%', gap: 2 },
  nowPlayingTimeLabels: { width: '100%', flexDirection: 'row', justifyContent: 'space-between' },
  nowPlayingTimeLabel: { width: 'auto', flexShrink: 0 },
  nowPlayingControls: { width: '100%', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  nowPlayingExpandedControls: { width: '100%', justifyContent: 'center', gap: 8 },
  nowPlayingStackedControls: { gap: 8 },
  nowPlayingVolume: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 2, marginTop: 0 },
  nowPlayingVolumeDisabled: { opacity: 0.45 },
  nowPlayingVolumeTrack: { height: 28, flex: 1, justifyContent: 'center' },
  nowPlayingVolumeRail: { height: 5, overflow: 'hidden', borderRadius: 4, backgroundColor: colors.border },
  nowPlayingVolumeFill: { height: '100%', borderRadius: 4, backgroundColor: '#93c5fd' },
  nowPlayingVolumeThumb: { position: 'absolute', width: 13, height: 13, marginLeft: -6.5, borderRadius: 7, borderWidth: 2, borderColor: colors.text, backgroundColor: '#93c5fd' },
  nowPlayingVolumeLabel: { minWidth: 28, color: colors.muted, fontSize: 9, fontVariant: ['tabular-nums'], textAlign: 'right' },
  nowPlayingControl: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  nowPlayingPrimaryControl: { width: 36, height: 36, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelRaised },
  nowPlayingControlPressed: { backgroundColor: colors.border },
  nowPlayingControlDisabled: { opacity: 0.4 },
  nowPlayingProgressTrack: { width: '100%', height: 3, marginTop: 3, overflow: 'hidden', borderRadius: 3, backgroundColor: colors.border },
  nowPlayingExpandedProgressTrack: { height: 5 },
  nowPlayingProgress: { height: '100%', borderRadius: 3, backgroundColor: '#93c5fd' },
  immersiveEmptyKey: { borderRadius: 10, backgroundColor: 'transparent' },
  immersiveEmptyDeck: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  immersiveTools: { position: 'absolute', top: 8, left: 20, right: 20, minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(24, 24, 27, 0.94)' },
  immersivePageTools: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  immersivePageButton: { height: 30, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 5 },
  immersiveExit: { width: 34, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 24 },
  widgetOnlyContent: { flexGrow: 0 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  immersiveToggle: { width: 34, height: 34, borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandName: { color: colors.text, fontWeight: '600', fontSize: 14 },
  connectionPill: { maxWidth: '62%', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, borderRadius: 6, paddingHorizontal: 9, height: 34, flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 5 },
  dotOnline: { backgroundColor: colors.mint },
  dotOffline: { backgroundColor: colors.faint },
  connectionText: { maxWidth: 150, flexShrink: 1, fontSize: 13, color: colors.muted, fontWeight: '500' },
  titleRow: { marginTop: 18, marginBottom: 17 },
  title: { color: colors.text, fontWeight: '600', fontSize: 23, letterSpacing: -0.3 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 5 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  managePages: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 7, borderRadius: 5, borderWidth: 1, borderColor: colors.border },
  managePagesText: { color: colors.muted, fontSize: 12 },
  pageTabs: { flexDirection: 'row', gap: 6, paddingBottom: 16 },
  pageTab: { height: 29, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 5, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  pageTabActive: { backgroundColor: colors.pressed, borderColor: '#52525b' },
  pageTabText: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  pageTabTextActive: { color: colors.text },
  connectBanner: { minHeight: 57, borderRadius: 7, paddingHorizontal: 12, marginBottom: 20, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 11 },
  bannerCopy: { flex: 1 },
  bannerTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  bannerSub: { color: colors.muted, fontSize: 12, marginTop: 4 },
  sectionTitle: { color: colors.muted, fontSize: 14, fontWeight: '500', marginBottom: 10 },
  widgetArea: { marginTop: 18, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.panel },
  widgetOnlyArea: { position: 'relative', marginTop: 0 },
  widgetOnlyEmpty: { ...StyleSheet.absoluteFill, zIndex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 },
  widgetAreaHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  widgetAreaTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  widgetAreaPage: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  grid: { position: 'relative' },
  key: { minHeight: 100, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, padding: 11, justifyContent: 'space-between' },
  emptyKey: { borderStyle: 'dashed', backgroundColor: 'transparent', opacity: 0.45 },
  appIcon: { width: 23, height: 23 },
  keyDisabled: { opacity: 0.52 },
  keyPressed: { backgroundColor: colors.pressed, borderColor: '#52525b' },
  keyLabel: { color: colors.text, fontSize: 13, fontWeight: '500', lineHeight: 14 },
  shortcutHint: { color: colors.faint, fontSize: 11, marginTop: -4 },
  addKey: { alignItems: 'flex-start', justifyContent: 'space-between', borderStyle: 'dashed', backgroundColor: 'transparent' },
  addLabel: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  feedbackRow: { minHeight: 40, marginTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  emptyDeck: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 7, backgroundColor: colors.panel },
  feedbackDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mint },
  feedbackText: { color: colors.faint, fontSize: 13 },
});
