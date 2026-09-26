import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { defaultDarkTheme, defaultLightTheme } from 'react-native-fast-chart';
import { Toggle } from './components/Toggle';
import { BenchmarkScreen } from './screens/BenchmarkScreen';
import { MarketScreen } from './screens/MarketScreen';
import { PlaygroundScreen, type ThemeMode } from './screens/PlaygroundScreen';

type Screen = 'playground' | 'market' | 'benchmark';

function ScreenSwitch({
  screen,
  mode,
  onChange,
}: {
  screen: Screen;
  mode: ThemeMode;
  onChange: (screen: Screen) => void;
}) {
  const theme =
    screen !== 'benchmark' && mode === 'light'
      ? defaultLightTheme
      : defaultDarkTheme;
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.switch,
        { backgroundColor: theme.surface, paddingBottom: insets.bottom + 6 },
      ]}
    >
      <Toggle
        label="Playground"
        active={screen === 'playground'}
        theme={theme}
        onPress={() => onChange('playground')}
      />
      <Toggle
        label="Market"
        active={screen === 'market'}
        theme={theme}
        onPress={() => onChange('market')}
      />
      <Toggle
        label="Benchmark"
        active={screen === 'benchmark'}
        theme={theme}
        onPress={() => onChange('benchmark')}
      />
    </View>
  );
}

export default function App() {
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [screen, setScreen] = useState<Screen>('playground');
  const dark = screen === 'benchmark' || mode === 'dark';

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <View style={styles.root}>
          {screen === 'playground' ? (
            <PlaygroundScreen mode={mode} onModeChange={setMode} />
          ) : screen === 'market' ? (
            <MarketScreen
              theme={mode === 'dark' ? defaultDarkTheme : defaultLightTheme}
            />
          ) : (
            <BenchmarkScreen />
          )}
        </View>
        <ScreenSwitch screen={screen} mode={mode} onChange={setScreen} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  switch: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 6,
  },
});
