/**
 * Benchmark scene descriptors (spec §28). Runners that execute these
 * scenes and collect FPS / memory are implemented in phase P8.
 */
export type BenchmarkSceneId = 'A' | 'B' | 'C' | 'D';

export interface BenchmarkIndicatorSpec {
  type: string;
  config: Readonly<Record<string, number>>;
}

export interface BenchmarkScenario {
  id: BenchmarkSceneId;
  title: string;
  /** Candles held in the store. */
  storedCandles: number;
  /** Candles in the viewport; `null` = fit all stored candles. */
  visibleCandles: number | null;
  indicators: readonly BenchmarkIndicatorSpec[];
  /** Realtime updates of the active candle per second; 0 = static. */
  realtimeUpdatesPerSecond: number;
  /** Whether the scene continuously pans while measuring. */
  panning: boolean;
}

const scenarios: Record<BenchmarkSceneId, BenchmarkScenario> = {
  A: {
    id: 'A',
    title: '500 candles, candles only',
    storedCandles: 500,
    visibleCandles: null,
    indicators: [],
    realtimeUpdatesPerSecond: 0,
    panning: false,
  },
  B: {
    id: 'B',
    title: '5k stored, 150 visible, EMA20 + EMA50',
    storedCandles: 5_000,
    visibleCandles: 150,
    indicators: [
      { type: 'ema', config: { period: 20 } },
      { type: 'ema', config: { period: 50 } },
    ],
    realtimeUpdatesPerSecond: 0,
    panning: false,
  },
  C: {
    id: 'C',
    title: '20k stored, Bollinger + Volume + MACD + RSI',
    storedCandles: 20_000,
    visibleCandles: 150,
    indicators: [
      { type: 'bollinger', config: { period: 20, stdDev: 2 } },
      { type: 'volume', config: {} },
      { type: 'macd', config: { fast: 12, slow: 26, signal: 9 } },
      { type: 'rsi', config: { period: 14 } },
    ],
    realtimeUpdatesPerSecond: 0,
    panning: false,
  },
  D: {
    id: 'D',
    title: 'Realtime stress: 20 updates/s while panning',
    storedCandles: 5_000,
    visibleCandles: 150,
    indicators: [
      { type: 'ema', config: { period: 20 } },
      { type: 'bollinger', config: { period: 20, stdDev: 2 } },
      { type: 'rsi', config: { period: 14 } },
      { type: 'macd', config: { fast: 12, slow: 26, signal: 9 } },
    ],
    realtimeUpdatesPerSecond: 20,
    panning: true,
  },
};

export const BENCHMARK_SCENARIOS: Readonly<
  Record<BenchmarkSceneId, BenchmarkScenario>
> = Object.freeze(scenarios);
