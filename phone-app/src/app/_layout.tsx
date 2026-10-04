import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { ConnectionProvider } from '../connection';
import { setLyricsUserAgent } from '../lyrics';
import { colors } from '../theme';

if (Platform.OS === 'android') {
  setLyricsUserAgent('Freeze/1.0 (https://github.com/naveen-devang/Freeze)');
}

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
