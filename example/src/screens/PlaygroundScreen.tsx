import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  TradingChart,
  defaultDarkTheme,
  defaultLightTheme,
  formatPrice,
  useTradingChartController,
  type ChartTheme,
  type CrosshairChange,
  type CrosshairMode,
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
  const [crosshairMode, setCrosshairMode] = useState<CrosshairMode>('hold');
  const [utc, setUtc] = useState(false);
  // Updated only when the crosshair changes bar (never per frame).
  const [inspected, setInspected] = useState<CrosshairChange | null>(null);
  const config = useMemo(
    () => ({
      debug: { profiling: debug },
      crosshair: { mode: crosshairMode },
      axes: { timeZone: utc ? ('utc' as const) : ('local' as const) },
    }),
    [debug, crosshairMode, utc]
  );
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
            label={crosshairMode === 'hold' ? 'Hold' : 'Sticky'}
            theme={theme}
            onPress={() =>
              setCrosshairMode((m) => (m === 'hold' ? 'sticky' : 'hold'))
            }
          />
          <Toggle
            label={utc ? 'UTC' : 'Local'}
            theme={theme}
            onPress={() => setUtc((u) => !u)}
          />
          <Toggle
            label={debug ? 'Hide debug' : 'Debug'}
            theme={theme}
            onPress={() => setDebug((d) => !d)}
          />
          <Toggle
            label={mode === 'dark' ? 'Light' : 'Dark'}
            theme={theme}
            onPress={() => onModeChange(mode === 'dark' ? 'light' : 'dark')}
          />
        </View>
      </View>
      <Text style={[styles.status, { color: theme.axis.textColor }]}>
        {inspected
          ? `#${inspected.index}  ${new Date(inspected.time).toISOString()}  ` +
            `C ${formatPrice(inspected.close, 2)}`
          : 'Long-press the chart to inspect a bar'}
      </Text>
      <View style={styles.chart}>
        <TradingChart
          controller={controller}
          candles={candles}
          theme={theme}
          config={config}
          onCrosshairChange={setInspected}
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
  status: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  button: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chart: { flex: 1 },
});
