import type { UnixMs } from './Candle';

/**
 * Timeframe parsing and UTC bucket alignment.
 *
 * Format: `<positive integer><unit>`, units `s` (second), `m` (minute),
 * `h` (hour), `d` (day), `w` (week), `M` (calendar month). Examples: `'1m'`,
 * `'15m'`, `'4h'`, `'1d'`, `'1w'`, `'1M'`.
 *
 * Alignment (Binance convention, all in UTC):
 * - `s`/`m`/`h`/`d`: multiples of the interval since the Unix epoch.
 * - `w`: weeks start on **Monday 00:00 UTC** (the epoch was a Thursday).
 * - `M`: first day of the month 00:00 UTC; multi-month buckets are counted
 *   from January 1970.
 */
export type TimeframeUnit = 's' | 'm' | 'h' | 'd' | 'w' | 'M';

export interface TimeframeSpec {
  readonly unit: TimeframeUnit;
  readonly count: number;
  /**
   * Interval length in ms. For months this is the **nominal** 30-day length;
   * use `getBucketStart` / `getNextBucketStart` for exact boundaries.
   */
  readonly ms: number;
}

const UNIT_MS: Record<TimeframeUnit, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  M: 2_592_000_000,
};

/** 1970-01-05T00:00Z, the first Monday after the epoch. */
const WEEK_ORIGIN = 4 * UNIT_MS.d;

const PATTERN = /^([1-9]\d{0,5})([smhdwM])$/;

/** Parses a timeframe string; returns `null` when malformed. */
export function parseTimeframe(timeframe: string): TimeframeSpec | null {
  const match = typeof timeframe === 'string' ? PATTERN.exec(timeframe) : null;
  if (match === null) {
    return null;
  }
  const count = Number(match[1]);
  const unit = match[2] as TimeframeUnit;
  return { unit, count, ms: count * UNIT_MS[unit] };
}

/**
 * Interval length in ms (months: nominal 30 days).
 * @throws {RangeError} when the timeframe is malformed.
 */
export function timeframeToMs(timeframe: string): number {
  const spec = parseTimeframe(timeframe);
  if (spec === null) {
    throw new RangeError(`Invalid timeframe: ${String(timeframe)}`);
  }
  return spec.ms;
}

function floorTo(time: number, size: number, origin: number): number {
  return Math.floor((time - origin) / size) * size + origin;
}

/** Open time of the bucket containing `time`; `NaN` for non-finite input. */
export function getBucketStart(time: UnixMs, spec: TimeframeSpec): UnixMs {
  if (!Number.isFinite(time)) {
    return NaN;
  }
  if (spec.unit === 'M') {
    const date = new Date(time);
    const months = date.getUTCFullYear() * 12 + date.getUTCMonth() - 1970 * 12;
    const aligned = Math.floor(months / spec.count) * spec.count;
    return Date.UTC(1970, aligned, 1);
  }
  return floorTo(time, spec.ms, spec.unit === 'w' ? WEEK_ORIGIN : 0);
}

/** Open time of the bucket following the one that starts at `bucketStart`. */
export function getNextBucketStart(
  bucketStart: UnixMs,
  spec: TimeframeSpec
): UnixMs {
  if (spec.unit === 'M') {
    const date = new Date(bucketStart);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + spec.count, 1);
  }
  return bucketStart + spec.ms;
}
