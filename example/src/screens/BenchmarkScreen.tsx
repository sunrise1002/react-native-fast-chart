import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  TradingChart,
  defaultDarkTheme,
  useTradingChartController,
  type Candle,
  type IndicatorInput,
  type TradingChartHandle,
} from 'react-native-fast-chart';
import { generateCandles } from 'react-native-fast-chart/testing';
import { DebugOverlay } from '../components/DebugOverlay';
import { Toggle } from '../components/Toggle';

/*
 * Spec §36 performance gate: 10k candles, ~200 visible, EMA 20 + EMA 50,
 * 10–20 realtime updates per second. The synthetic feed moves the last
 * bar on every tick and opens a new bar every `TICKS_PER_BAR` ticks.
 * Profiling is always on; read FPS / frame / render / indicator timings
 * from the overlay while the feed runs (and while panning / zooming).
 */

const BARS = 10_000;
const VISIBLE_BARS = 200;
const TICKS_PER_BAR = 60;
const RATES = [10, 20] as const;
type Rate = (typeof RATES)[number];

const GATE_INDICATORS: readonly IndicatorInput[] = [
  { type: 'ema', config: { period: 20 } },
  { type: 'ema', config: { period: 50 } },
];

interface FeedStats {
  ticks: number;
  startedAt: number;
}

/** Random-walk tick on the last bar; returns `false` when rejected. */
function tick(controller: TradingChartHandle, last: Candle, n: number) {
  const step = (Math.random() - 0.5) * last.close * 0.001;
  const close = last.close + step;
  if (n % TICKS_PER_BAR === 0) {
    const next: Candle = {
      time: last.time + 60_000,
      open: last.close,
      high: Math.max(last.close, close),
      low: Math.min(last.close, close),
      close,
      volume: Math.random() * 10,
    };
    return controller.appendBar(next) ? next : last;
  }
  const next: Candle = {
    ...last,
    close,
    high: Math.max(last.high, close),
    low: Math.min(last.low, close),
    volume: last.volume + Math.random(),
  };
  return controller.updateLastBar(next) ? next : last;
}

export function BenchmarkScreen() {
  const theme = defaultDarkTheme;
  const controller = useTradingChartController();
  const { width } = useWindowDimensions();
  const candles = useMemo(() => generateCandles({ count: BARS, seed: 7 }), []);
  const [running, setRunning] = useState(true);
  const [rate, setRate] = useState<Rate>(20);
  const stats = useRef<FeedStats>({ ticks: 0, startedAt: Date.now() });
  const config = useMemo(
    () => ({
      debug: { profiling: true },
      // ~64 dp price axis: the plot shows about VISIBLE_BARS bars.
      viewport: {
        initialBarSpacing: Math.max(0.5, (width - 64) / VISIBLE_BARS),
      },
    }),
    [width]
  );

  useEffect(() => {
    if (!running) {
      return;
    }
    let last = candles[candles.length - 1] as Candle;
    let n = 0;
    stats.current = { ticks: 0, startedAt: Date.now() };
    const id = setInterval(() => {
      last = tick(controller, last, ++n);
      stats.current.ticks++;
    }, 1000 / rate);
    return () => clearInterval(id);
  }, [controller, candles, running, rate]);

  const getSnapshot = useCallback(
    () => controller.metrics.snapshot(),
    [controller]
  );
  const getExtraLines = useCallback(() => {
    const { ticks, startedAt } = stats.current;
    const seconds = Math.max(1e-3, (Date.now() - startedAt) / 1000);
    return [
      `feed ${running ? `${rate} Hz` : 'paused'}  ${(ticks / seconds).toFixed(1)} ticks/s`,
      `bars ${controller.store.length}`,
    ];
  }, [controller, running, rate]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.axis.textColor }]}>
          Benchmark §36
        </Text>
        <View style={styles.actions}>
          {RATES.map((r) => (
            <Toggle
              key={r}
              label={`${r} Hz`}
              active={rate === r}
              theme={theme}
              onPress={() => setRate(r)}
            />
          ))}
          <Toggle
            label={running ? 'Pause' : 'Run'}
            theme={theme}
            onPress={() => setRunning((v) => !v)}
          />
        </View>
      </View>
      <Text style={[styles.status, { color: theme.axis.textColor }]}>
        {`${BARS} candles · ~${VISIBLE_BARS} visible · EMA 20 + EMA 50`}
      </Text>
      <View style={styles.chart}>
        <TradingChart
          controller={controller}
          candles={candles}
          theme={theme}
          config={config}
          indicators={GATE_INDICATORS}
        />
        <DebugOverlay getSnapshot={getSnapshot} getExtraLines={getExtraLines} />
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
  actions: { flexDirection: 'row', gap: 6 },
  title: { fontSize: 18, fontWeight: '600' },
  status: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  chart: { flex: 1 },
});
