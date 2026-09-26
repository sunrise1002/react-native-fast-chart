import type { UnixMs } from '../data/Candle';

export type { Candle, TimeUnit, UnixMs } from '../data/Candle';

/** Supported bar intervals. Custom strings (e.g. `'2h'`) are allowed. */
export type Timeframe =
  | '1s'
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '4h'
  | '1d'
  | '1w'
  | '1M'
  | (string & {});

/** Width / height, dp. */
export interface Size {
  width: number;
  height: number;
}

/** Axis-aligned rectangle, dp. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Range of bar indices (fractional, "logical" indices). `from` is inclusive,
 * `to` is inclusive; either may extend beyond the data (whitespace).
 */
export interface LogicalRange {
  from: number;
  to: number;
}

/** Range of bar open times, Unix ms, inclusive. */
export interface TimeRange {
  from: UnixMs;
  to: UnixMs;
}

/** Closed price interval `[min, max]`. */
export interface PriceRange {
  min: number;
  max: number;
}
