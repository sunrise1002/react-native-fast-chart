import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  TradingChart,
  defaultClock,
  defaultDarkTheme,
  defaultLightTheme,
  normalizeCandles,
} from 'react-native-fast-chart';
import { generateCandles } from 'react-native-fast-chart/testing';

export type ThemeMode = 'dark' | 'light';

const CANDLE_COUNT = 100_000;

interface DatasetInfo {
  count: number;
  dropped: number;
  generateMs: number;
  normalizeMs: number;
}

/** Generates and normalizes the demo dataset once, reporting timings. */
function buildDataset(): DatasetInfo {
  const t0 = defaultClock();
  const raw = generateCandles({ count: CANDLE_COUNT, seed: 42 });
  const t1 = defaultClock();
  const { candles, issues } = normalizeCandles(raw);
  const t2 = defaultClock();
  return {
    count: candles.length,
    dropped: issues.length,
    generateMs: t1 - t0,
    normalizeMs: t2 - t1,
  };
}

interface PlaygroundScreenProps {
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
}

export function PlaygroundScreen({
  mode,
  onModeChange,
}: PlaygroundScreenProps) {
  const theme = mode === 'dark' ? defaultDarkTheme : defaultLightTheme;
  const dataset = useMemo(buildDataset, []);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.axis.textColor }]}>
          Playground
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onModeChange(mode === 'dark' ? 'light' : 'dark')}
          style={[styles.button, { borderColor: theme.axis.lineColor }]}
        >
          <Text style={{ color: theme.axis.textColor }}>
            {mode === 'dark' ? 'Light theme' : 'Dark theme'}
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.info, { color: theme.axis.textColor }]}>
        {`${dataset.count.toLocaleString()} candles · generated in ${dataset.generateMs.toFixed(
          0
        )} ms · normalized in ${dataset.normalizeMs.toFixed(0)} ms · dropped ${
          dataset.dropped
        }`}
      </Text>
      <TradingChart theme={theme} style={styles.chart} />
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
  title: { fontSize: 18, fontWeight: '600' },
  button: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  info: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 8 },
  chart: { flex: 1 },
});
