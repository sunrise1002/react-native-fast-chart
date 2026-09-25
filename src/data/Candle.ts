/**
 * Timestamp policy (applies to the whole engine):
 *
 * - Every `time` value is a **Unix epoch timestamp in milliseconds** (UTC),
 *   stored as a plain `number`, and must be a non-negative safe integer.
 * - `time` marks the **open** of the bar (Binance/TradingView convention).
 * - Data sources that deliver seconds must be converted at the boundary
 *   (see `normalizeCandles(input, { timeUnit: 's' })`); internal code never
 *   guesses the unit.
 */
export type UnixMs = number;

/** A single OHLCV bar. Prices are raw floating point values. */
export interface Candle {
  /** Bar open time, Unix epoch milliseconds (UTC). */
  time: UnixMs;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Traded volume, `>= 0`. Missing volume is normalized to `0`. */
  volume: number;
}

/** Unit of timestamps in raw input data. */
export type TimeUnit = 'ms' | 's';

export const MS_PER_SECOND = 1000;
