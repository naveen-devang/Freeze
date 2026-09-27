import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppWindow, ChevronRight, Command, Headphones, Keyboard, Layers2, ListOrdered, Mic, Monitor, Music, PanelsTopLeft, Pause, Play, SkipBack, SkipForward, Snowflake, Volume1, Volume2, VolumeX, Wifi } from 'lucide-react-native';
import { SvgXml } from 'react-native-svg';
import { DeckButton, DeckMediaCommand, PlaybackState, usePcConnection } from '../../connection';
import { colors } from '../../theme';

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
  if (action.type === 'sequence') return ListOrdered;
  if (action.type === 'select_profile') return Layers2;
  if (action.type === 'select_page') return PanelsTopLeft;
  return Keyboard;
}

export default function DeckScreen() {
  const router = useRouter();
  const { connection, status, playbackState, actionError, deckConfig, sendButton, selectPage } = usePcConnection();
  const [feedback, setFeedback] = useState('');
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeProfile = deckConfig?.profiles.find((profile) => profile.id === deckConfig.activeProfileId);
  const activePage = activeProfile?.pages.find((page) => page.id === activeProfile.activePageId);

  useEffect(() => () => {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
  }, []);

  const connected = status === 'connected';
  const isPlaying = playbackState === 'playing';
  const columns = activePage?.columns ?? 3;
  const rows = activePage?.rows ?? Math.max(1, Math.ceil((activePage?.buttons.length ?? 0) / columns));
  const buttonWidth = `${100 / columns - 1}%` as `${number}%`;
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brand}><Snowflake size={19} color={colors.text} strokeWidth={1.8} /><Text style={styles.brandName}>Freeze</Text></View>
          <Pressable style={styles.connectionPill} onPress={() => router.push('/connect')} accessibilityRole="button" accessibilityLabel={`PC ${connected ? 'connected' : 'disconnected'}. Open connection settings`}>
            <View style={[styles.dot, connected ? styles.dotOnline : styles.dotOffline]} />
            <Text style={styles.connectionText} numberOfLines={1}>{connected ? (connection?.deviceName ?? 'Connected') : 'Connect PC'}</Text>
            <ChevronRight size={14} color={colors.faint} />
          </Pressable>
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

        {activePage ? <>
          <Text style={styles.sectionTitle}>{activePage.name}</Text>
          <View style={styles.grid}>
            {Array.from({ length: rows * columns }, (_, index) => {
              const button = activePage.buttons[index];
              if (!button) return <View key={`empty-${index}`} style={[styles.key, styles.emptyKey, { width: buttonWidth }]} />;
              const dynamicPlay = button.icon === 'auto' && button.action.type === 'media' && button.action.command === 'play_pause';
              const label = dynamicPlay ? (isPlaying ? 'Pause' : 'Play') : button.label;
              const Icon = controlIcon(button, playbackState);
              return <Pressable key={button.id} style={({ pressed }) => [styles.key, { width: buttonWidth }, pressed && styles.keyPressed, !connected && styles.keyDisabled]} onPress={() => press(button, label)} disabled={!connected} accessibilityRole="button" accessibilityLabel={label}>
                {button.appIconData ? <Image source={{ uri: button.appIconData }} style={styles.appIcon} resizeMode="contain" /> : button.iconSvg && button.icon !== 'auto' ? <SvgXml xml={button.iconSvg} width={21} height={21} /> : <Icon size={21} color={colors.text} strokeWidth={1.7} />}
                <Text style={styles.keyLabel} numberOfLines={2}>{label}</Text>
              </Pressable>;
            })}
          </View>
        </> : <View style={styles.emptyDeck}><Command size={20} color={colors.faint} /><Text style={styles.feedbackText}>{connected ? 'The desktop has no active deck page.' : 'Connect to a PC to load its deck.'}</Text></View>}

        <View style={styles.feedbackRow}>
          {actionError ? <><Wifi size={13} color={colors.faint} /><Text style={styles.feedbackText}>{actionErrorText}</Text></> : feedback ? <><View style={styles.feedbackDot} /><Text style={styles.feedbackText}>{feedback}</Text></> : <><Wifi size={13} color={colors.faint} /><Text style={styles.feedbackText}>{connected ? 'Ready to send controls' : 'Connect to enable controls'}</Text></>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 18, paddingBottom: 24 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 9 },
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
