import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ConnectionProvider } from '../connection';
import { colors } from '../theme';

export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <ConnectionProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ConnectionProvider>
    </ThemeProvider>
  );
}
