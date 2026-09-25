import { useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CandleStore,
  RealtimeBarAggregator,
  candleRangeMinMax,
  clampBarSpacing,
  clampRightOffset,
  createPriceScale,
  defaultClock,
  getVisibleRange,
  panRightOffset,
  resolveChartConfig,
  zoomRightOffset,
  type ChartTheme,
  type PriceRange,
  type TimeScaleState,
} from 'react-native-fast-chart';
import { generateCandles } from 'react-native-fast-chart/testing';

const CANDLE_COUNT = 100_000;
const TRADE_BURST = 1_000;
const config = resolveChartConfig();
const viewport = config.viewport;

interface Engine {
  store: CandleStore;
  aggregator: RealtimeBarAggregator;
  loadMs: number;
}

/** Builds the data engine once: 100k 1m candles + a trade aggregator. */
function createEngine(): Engine {
  const candles = generateCandles({ count: CANDLE_COUNT, seed: 42 });
  const t0 = defaultClock();
  const store = new CandleStore(candles);
  const loadMs = defaultClock() - t0;
  const aggregator = new RealtimeBarAggregator(store, { timeframe: '1m' });
  return { store, aggregator, loadMs };
}

interface EngineDemoProps {
  theme: ChartTheme;
  /** Plot width used by the viewport math, px. */
  width: number;
}

/**
 * P2 demo: drives the pure-TS data + viewport engines with buttons and
 * prints what the renderer (P3) will consume. React state is fine here
 * because nothing runs per frame yet.
 */
export function EngineDemo({ theme, width }: EngineDemoProps) {
  const engine = useMemo(createEngine, []);
  const { store, aggregator } = engine;
  // The store is a non-React event source; React only re-reads its version.
  const version = useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.version
  );
  const [scale, setScale] = useState({
    barSpacing: viewport.initialBarSpacing,
    rightOffset: config.layout.rightOffsetBars,
  });
  const [burstMs, setBurstMs] = useState<number | null>(null);

  const state: TimeScaleState = { width, barCount: store.length, ...scale };
  const range = getVisibleRange(state, viewport.overscanBars);
  const prices: PriceRange = { min: NaN, max: NaN };
  candleRangeMinMax(store.columns, range.startIndex, range.endIndex, prices);
  const priceScale = createPriceScale(prices, 0, 400);
  const last = store.get(store.length - 1);

  const pan = (dx: number) =>
    setScale((s) => {
      const current = { ...state, ...s };
      const rightOffset = panRightOffset(current, dx);
      return {
        ...s,
        rightOffset: clampRightOffset(current, rightOffset, viewport),
      };
    });
  const zoom = (factor: number) =>
    setScale((s) => {
      const current = { ...state, ...s };
      const barSpacing = clampBarSpacing(s.barSpacing * factor, viewport);
      const rightOffset = zoomRightOffset(current, barSpacing, width / 2);
      return {
        barSpacing,
        rightOffset: clampRightOffset(
          { ...current, barSpacing },
          rightOffset,
          viewport
        ),
      };
    });
  const streamTrades = () => {
    const t0 = defaultClock();
    let time = Math.max(store.lastTime, Date.now());
    let price = last?.close ?? 100;
    for (let i = 0; i < TRADE_BURST; i++) {
      time += 250; // 4 trades per second → a new 1m bar every 240 trades
      price *= 1 + (Math.random() - 0.5) * 0.001;
      aggregator.addTrade(price, Math.random(), time);
    }
    setBurstMs(defaultClock() - t0);
  };

  const color = { color: theme.axis.textColor };
  const buttons: Array<[string, () => void]> = [
    ['◀ pan', () => pan(200)],
    ['pan ▶', () => pan(-200)],
    ['zoom +', () => zoom(1.25)],
    ['zoom −', () => zoom(0.8)],
    [
      'live',
      () =>
        setScale((s) => ({ ...s, rightOffset: config.layout.rightOffsetBars })),
    ],
    [`${TRADE_BURST} trades`, streamTrades],
  ];

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        {buttons.map(([label, onPress]) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            onPress={onPress}
            style={[styles.button, { borderColor: theme.axis.lineColor }]}
          >
            <Text style={color}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.info, color]}>
        {[
          `store v${version}: ${store.length.toLocaleString()} bars, loaded in ${engine.loadMs.toFixed(1)} ms`,
          `bar spacing ${scale.barSpacing.toFixed(2)} px · right offset ${scale.rightOffset.toFixed(1)} bars`,
          `render range ${range.startIndex}…${range.endIndex} (${range.endIndex - range.startIndex + 1} bars incl. overscan)`,
          `autoscale ${prices.min.toFixed(2)} – ${prices.max.toFixed(2)} → axis ${priceScale.min.toFixed(2)} – ${priceScale.max.toFixed(2)}`,
          `last close ${last?.close.toFixed(2) ?? '—'}${burstMs === null ? '' : ` · ${TRADE_BURST} trades in ${burstMs.toFixed(2)} ms`}`,
        ].join('\n')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  button: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  info: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
