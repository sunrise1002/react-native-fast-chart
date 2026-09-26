import type { Candle, LoadMoreResult } from 'react-native-fast-chart';
import {
  createSeededRandom,
  generateCandles,
} from 'react-native-fast-chart/testing';
import {
  PAGE_SIZE,
  TIMEFRAME_MS,
  type MarketSource,
  type MarketStreamHandlers,
  type MarketSymbol,
  type MarketTimeframe,
} from './types';

/*
 * MOCK MARKET — EXAMPLE / TESTS ONLY. Fake, deterministic data; never use
 * it as a real data source.
 *
 * - History: a finite seeded series per symbol × timeframe (so "no more
 *   history" is reachable), served in pages with 300–900 ms latency.
 * - Stream: 15 ticks/s on the forming bar. Simulated time runs ~40 ticks
 *   per bar, so interval rollovers happen every few seconds. Every ~30 s
 *   the feed "drops" for 2 s (status `reconnecting`, no ticks) and then
 *   reports `delayed` briefly before going `live` again.
 */

const HISTORY_BARS = 6_000;
const TICKS_PER_SECOND = 15;
const TICKS_PER_BAR = 40;
const DROP_EVERY_TICKS = 30 * TICKS_PER_SECOND;
const DROP_TICKS = 2 * TICKS_PER_SECOND;
const DELAYED_TICKS = TICKS_PER_SECOND;

const START_PRICE: Readonly<Record<MarketSymbol, number>> = {
  BTCUSDT: 64_000,
  ETHUSDT: 3_200,
  SOLUSDT: 150,
};

const history = new Map<string, Candle[]>();

function seriesFor(symbol: MarketSymbol, timeframe: MarketTimeframe): Candle[] {
  const key = `${symbol}:${timeframe}`;
  let rows = history.get(key);
  if (!rows) {
    const intervalMs = TIMEFRAME_MS[timeframe];
    const end = Math.floor(Date.now() / intervalMs) * intervalMs;
    rows = generateCandles({
      count: HISTORY_BARS,
      seed: key.length * 7919 + START_PRICE[symbol],
      startTime: end - (HISTORY_BARS - 1) * intervalMs,
      intervalMs,
      startPrice: START_PRICE[symbol],
    });
    history.set(key, rows);
  }
  return rows;
}

function withLatency<T>(value: () => T): Promise<T> {
  const ms = 300 + Math.random() * 600;
  return new Promise((resolve) => setTimeout(() => resolve(value()), ms));
}

/** First index with `time >= before` (rows sorted by time). */
function lowerBound(rows: readonly Candle[], before: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((rows[mid] as Candle).time < before) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function subscribe(
  symbol: MarketSymbol,
  timeframe: MarketTimeframe,
  { onBar, onStatus }: MarketStreamHandlers
): () => void {
  const rows = seriesFor(symbol, timeframe);
  const intervalMs = TIMEFRAME_MS[timeframe];
  const random = createSeededRandom(rows.length + START_PRICE[symbol]);
  const seed = rows[rows.length - 1] as Candle;
  let bar: Candle = { ...seed };
  let tick = 0;
  onStatus('live');
  const timer = setInterval(() => {
    tick++;
    const phase = tick % DROP_EVERY_TICKS;
    if (phase === 0) onStatus('reconnecting');
    if (phase < DROP_TICKS) return;
    if (phase === DROP_TICKS) onStatus('delayed');
    if (phase === DROP_TICKS + DELAYED_TICKS) onStatus('live');
    if (tick % TICKS_PER_BAR === 0) {
      const open = bar.close;
      bar = {
        time: bar.time + intervalMs,
        open,
        high: open,
        low: open,
        close: open,
        volume: 0,
      };
    }
    const step = (random() - 0.5) * bar.close * 0.0015;
    const close = Math.max(0.01, +(bar.close + step).toFixed(2));
    bar = {
      ...bar,
      close,
      high: Math.max(bar.high, close),
      low: Math.min(bar.low, close),
      volume: +(bar.volume + random() * 3).toFixed(3),
    };
    onBar(bar);
  }, 1000 / TICKS_PER_SECOND);
  return () => {
    clearInterval(timer);
    onStatus('offline');
  };
}

export const mockMarket: MarketSource = {
  name: 'Mock',
  loadLatest: (symbol, timeframe) =>
    withLatency(() => seriesFor(symbol, timeframe).slice(-PAGE_SIZE)),
  loadBefore: (symbol, timeframe, before) =>
    withLatency((): LoadMoreResult => {
      const rows = seriesFor(symbol, timeframe);
      const end = lowerBound(rows, before);
      const start = Math.max(0, end - PAGE_SIZE);
      return { candles: rows.slice(start, end), hasMore: start > 0 };
    }),
  subscribe,
};
