import { useState } from 'react';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { TabBarHiddenContext } from '../../navigation/tab-bar-context';

export default function TabLayout() {
  const [hidden, setHidden] = useState(false);

  return (
    <TabBarHiddenContext.Provider value={setHidden}>
      <NativeTabs
        hidden={hidden}
        sidebarAdaptable
      >
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="square.grid.2x2" md="grid_view" />
          <NativeTabs.Trigger.Label>Deck</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="connect">
          <NativeTabs.Trigger.Icon sf="wifi" md="wifi" />
          <NativeTabs.Trigger.Label>Connect</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="edit">
          <NativeTabs.Trigger.Icon sf="square.stack.3d.up" md="layers" />
          <NativeTabs.Trigger.Label>Profiles</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </TabBarHiddenContext.Provider>
  );
}
