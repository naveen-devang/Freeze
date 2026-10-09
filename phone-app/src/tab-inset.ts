import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Room to leave under a scrolling screen. On iOS the tab bar floats over the content, so the last row would
// sit behind it; on Android the bar has its own space.
export function useTabBarClearance(base = 24): number {
  const { bottom } = useSafeAreaInsets();
  return Platform.OS === 'ios' ? bottom + 64 + base : base;
}
