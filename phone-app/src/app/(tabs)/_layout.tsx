import { Tabs } from 'expo-router';
import { Grid2x2, Layers2, Wifi } from 'lucide-react-native';
import { colors } from '../../theme';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      sceneStyle: { backgroundColor: colors.bg },
      tabBarStyle: { backgroundColor: colors.panel, borderTopColor: colors.border, height: 62, paddingTop: 7, paddingBottom: 7 },
      tabBarActiveTintColor: colors.text,
      tabBarInactiveTintColor: colors.faint,
      tabBarLabelStyle: { fontSize: 13, fontWeight: '500' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Deck', tabBarIcon: ({ color }) => <Grid2x2 color={color} size={18} strokeWidth={1.8} /> }} />
      <Tabs.Screen name="connect" options={{ title: 'Connect', tabBarIcon: ({ color }) => <Wifi color={color} size={18} strokeWidth={1.8} /> }} />
      <Tabs.Screen name="edit" options={{ title: 'Profiles', tabBarIcon: ({ color }) => <Layers2 color={color} size={18} strokeWidth={1.8} /> }} />
    </Tabs>
  );
}
