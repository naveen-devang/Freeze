import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Layers2, Wifi } from 'lucide-react-native';
import { usePcConnection } from '../../connection';
import { colors } from '../../theme';

export default function ProfilesScreen() {
  const { status, deckConfig, actionError, selectProfile } = usePcConnection();
  const activeProfileId = deckConfig?.activeProfileId;

  const chooseProfile = (profileId: string) => {
    selectProfile(profileId);
  };

  return <SafeAreaView style={styles.safe} edges={['top']}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heading}><Layers2 size={19} color={colors.muted} /><Text style={styles.title}>Profiles</Text></View>
      <Text style={styles.description}>Choose a profile already set up on your Freeze desktop app.</Text>
      {actionError ? <Text style={styles.error}>Could not switch profiles. Check the connection and try again.</Text> : null}
      {status !== 'connected' ? <View style={styles.info}><Wifi size={16} color={colors.muted} /><Text style={styles.infoText}>Connect to a PC to view and switch its profiles.</Text></View> : null}
      {deckConfig?.profiles.map((profile) => {
        const selected = profile.id === activeProfileId;
        return <Pressable key={profile.id} style={[styles.profile, selected && styles.profileSelected]} onPress={() => chooseProfile(profile.id)} disabled={status !== 'connected' || selected} accessibilityRole="button" accessibilityState={{ selected, disabled: status !== 'connected' }}>
          <View style={styles.profileCopy}><Text style={styles.profileName}>{profile.name}</Text><Text style={styles.profilePages}>{profile.pages.length} {profile.pages.length === 1 ? 'page' : 'pages'}</Text></View>
          {selected ? <View style={styles.selectedMark}><Check size={15} color={colors.text} /><Text style={styles.selectedText}>Active</Text></View> : null}
        </Pressable>;
      })}
      {status === 'connected' && deckConfig?.profiles.length === 0 ? <Text style={styles.infoText}>No profiles are available on this PC.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 18, paddingBottom: 28 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 },
  title: { color: colors.text, fontSize: 23, fontWeight: '600', letterSpacing: -0.3 },
  description: { color: colors.muted, fontSize: 14, lineHeight: 17, marginTop: 7, marginBottom: 18 },
  info: { minHeight: 54, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 7, backgroundColor: colors.panel },
  infoText: { color: colors.muted, fontSize: 13, lineHeight: 15, flex: 1 },
  error: { color: colors.red, fontSize: 13, marginBottom: 10 },
  profile: { minHeight: 64, paddingHorizontal: 13, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: 7, backgroundColor: colors.panel },
  profileSelected: { borderColor: '#52525b', backgroundColor: colors.pressed },
  profileCopy: { gap: 5 },
  profileName: { color: colors.text, fontSize: 15, fontWeight: '500' },
  profilePages: { color: colors.muted, fontSize: 12 },
  selectedMark: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  selectedText: { color: colors.muted, fontSize: 13 },
});
