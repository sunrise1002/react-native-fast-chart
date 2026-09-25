import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  TradingChart,
  defaultDarkTheme,
  defaultLightTheme,
  useTradingChartController,
  type ChartTheme,
} from 'react-native-fast-chart';
import { generateCandles } from 'react-native-fast-chart/testing';
import { DebugOverlay } from '../components/DebugOverlay';
import { JumpToLatestButton } from '../components/JumpToLatestButton';

export type ThemeMode = 'dark' | 'light';

/** Size of the fixture dataset (spec Phase 3 playground). */
const FIXTURE_BARS = 10_000;

interface PlaygroundScreenProps {
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
}

interface ToggleProps {
  label: string;
  theme: ChartTheme;
  onPress: () => void;
}

function Toggle({ label, theme, onPress }: ToggleProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.button, { borderColor: theme.axis.lineColor }]}
    >
      <Text style={{ color: theme.axis.textColor }}>{label}</Text>
    </Pressable>
  );
}

export function PlaygroundScreen({
  mode,
  onModeChange,
}: PlaygroundScreenProps) {
  const theme = mode === 'dark' ? defaultDarkTheme : defaultLightTheme;
  const controller = useTradingChartController();
  const candles = useMemo(
    () => generateCandles({ count: FIXTURE_BARS, seed: 42 }),
    []
  );
  const [debug, setDebug] = useState(false);
  const config = useMemo(() => ({ debug: { profiling: debug } }), [debug]);
  const getSnapshot = useCallback(
    () => controller.metrics.snapshot(),
    [controller]
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.axis.textColor }]}>
          Playground
        </Text>
        <View style={styles.actions}>
          <Toggle
            label={debug ? 'Hide debug' : 'Debug'}
            theme={theme}
            onPress={() => setDebug((d) => !d)}
          />
          <Toggle
            label={mode === 'dark' ? 'Light theme' : 'Dark theme'}
            theme={theme}
            onPress={() => onModeChange(mode === 'dark' ? 'light' : 'dark')}
          />
        </View>
      </View>
      <View style={styles.chart}>
        <TradingChart
          controller={controller}
          candles={candles}
          theme={theme}
          config={config}
        />
        <JumpToLatestButton controller={controller} theme={theme} />
        {debug ? <DebugOverlay getSnapshot={getSnapshot} /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  actions: { flexDirection: 'row', gap: 8 },
  title: { fontSize: 18, fontWeight: '600' },
  button: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chart: { flex: 1 },
});
