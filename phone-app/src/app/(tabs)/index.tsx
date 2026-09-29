import { useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { BackHandler, Image, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppWindow, ChevronRight, Clock, Command, File, FolderOpen, Headphones, Keyboard, Layers2, ListOrdered, Maximize2, Mic, Minimize2, Monitor, Music, PanelsTopLeft, Pause, Play, SkipBack, SkipForward, Snowflake, Volume1, Volume2, VolumeX, Wifi } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { NavigationBar } from 'expo-navigation-bar';
import { useCalendars } from 'expo-localization';
import { SvgXml } from 'react-native-svg';
import { DeckButton, DeckMediaCommand, PlaybackState, usePcConnection } from '../../connection';
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

export default function DeckScreen() {
  const router = useRouter();
  const setTabBarHidden = useContext(TabBarHiddenContext);
  const { connection, status, playbackState, actionError, deckConfig, independentNavigation, selectedProfileId, selectedPageId, sendButton, selectPage } = usePcConnection();
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
  const widgetOnlyMode = rows === 0 && columns === 0 && hasWidgetArea;
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
  const regularCellWidth = Math.max(0, (regularGridWidth - regularGap * (columns - 1)) / columns);
  const widgetCellWidth = Math.max(0, (widgetGridWidth - regularGap * (displayWidgetColumns - 1)) / displayWidgetColumns);
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
                return <View key={item.widget.id} style={[styles.immersiveKey, styles.clockWidgetKey, cellFrame(placement.row - widgetTopRow, placement.column - widgetLeftColumn, placement.rowSpan, placement.columnSpan, immersiveWidgetCellWidth, immersiveWidgetCellHeight, immersiveGap, 12, 0)]}><ClockWidget immersive /></View>;
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
                return <View key={item.widget.id} style={[styles.key, styles.clockWidgetKey, cellFrame(placement.row - widgetTopRow, placement.column - widgetLeftColumn, placement.rowSpan, placement.columnSpan, widgetCellWidth, widgetCellHeight)]}><ClockWidget /></View>;
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
