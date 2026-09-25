import { MS_PER_SECOND, type Candle, type TimeUnit } from './Candle';

/** Why a candle row was rejected or flagged. */
export type CandleIssueReason =
  | 'NOT_AN_OBJECT'
  | 'INVALID_TIME'
  | 'NON_FINITE_PRICE'
  | 'INVALID_VOLUME'
  | 'HIGH_BELOW_BODY'
  | 'LOW_ABOVE_BODY'
  | 'DUPLICATE_TIME'
  | 'OUT_OF_ORDER';

export interface CandleIssue {
  /** Index of the offending row in the input array. */
  index: number;
  reason: CandleIssueReason;
}

export interface CandleValidationResult {
  /** `true` when every row is valid and times are strictly increasing. */
  valid: boolean;
  issues: CandleIssue[];
}

export interface NormalizeCandlesOptions {
  /** Unit of `time` in the input. Output is always Unix ms. Default `'ms'`. */
  timeUnit?: TimeUnit;
}

export interface NormalizeCandlesResult {
  /** Valid candles, strictly ascending by time, one per timestamp. */
  candles: Candle[];
  /** Dropped rows (invalid ones and superseded duplicates). */
  issues: CandleIssue[];
}

type UnknownRecord = Record<string, unknown>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Checks price/volume invariants of raw OHLCV fields. */
function getOhlcvIssue(
  open: unknown,
  high: unknown,
  low: unknown,
  close: unknown,
  volume: unknown
): CandleIssueReason | null {
  if (
    !isFiniteNumber(open) ||
    !isFiniteNumber(high) ||
    !isFiniteNumber(low) ||
    !isFiniteNumber(close)
  ) {
    return 'NON_FINITE_PRICE';
  }
  if (!isFiniteNumber(volume) || volume < 0) {
    return 'INVALID_VOLUME';
  }
  if (high < (open > close ? open : close)) {
    return 'HIGH_BELOW_BODY';
  }
  if (low > (open < close ? open : close)) {
    return 'LOW_ABOVE_BODY';
  }
  return null;
}

/**
 * Returns the first reason why `value` is not a valid `Candle`, or `null`.
 * Checks, in order: object shape, time, finite prices, volume, high/low.
 */
export function getCandleIssue(value: unknown): CandleIssueReason | null {
  if (value === null || typeof value !== 'object') {
    return 'NOT_AN_OBJECT';
  }
  const row = value as UnknownRecord;
  if (!isValidTime(row.time)) {
    return 'INVALID_TIME';
  }
  return getOhlcvIssue(row.open, row.high, row.low, row.close, row.volume);
}

/**
 * Numeric fast path of `getCandleIssue` for already-destructured bar values
 * (no object allocation). Used by `CandleStore` mutation methods.
 */
export function getBarValuesIssue(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number
): CandleIssueReason | null {
  if (!isValidTime(time)) {
    return 'INVALID_TIME';
  }
  return getOhlcvIssue(open, high, low, close, volume);
}

/** Type guard for a single well-formed candle (strict: volume required). */
export function isValidCandle(value: unknown): value is Candle {
  return getCandleIssue(value) === null;
}

/**
 * Validates a dataset without modifying it. Reports every invalid row plus
 * ordering problems between consecutive valid rows.
 */
export function validateCandles(
  input: readonly unknown[]
): CandleValidationResult {
  const issues: CandleIssue[] = [];
  let lastTime = -1;
  for (let index = 0; index < input.length; index++) {
    const value = input[index];
    const reason = getCandleIssue(value);
    if (reason !== null) {
      issues.push({ index, reason });
      continue;
    }
    const time = (value as Candle).time;
    if (time === lastTime) {
      issues.push({ index, reason: 'DUPLICATE_TIME' });
    } else if (time < lastTime) {
      issues.push({ index, reason: 'OUT_OF_ORDER' });
    }
    if (time > lastTime) {
      lastTime = time;
    }
  }
  return { valid: issues.length === 0, issues };
}

interface IndexedCandle {
  index: number;
  candle: Candle;
}

/** Validates a raw row and converts it to a fresh, monomorphic `Candle`. */
function toCandle(
  value: unknown,
  timeFactor: number
): Candle | CandleIssueReason {
  if (value === null || typeof value !== 'object') {
    return 'NOT_AN_OBJECT';
  }
  const row = value as UnknownRecord;
  const rawTime = row.time;
  const time = isFiniteNumber(rawTime) ? rawTime * timeFactor : Number.NaN;
  if (!isValidTime(time)) {
    return 'INVALID_TIME';
  }
  // Missing volume is tolerated (spec §26) and normalized to 0.
  const volume = row.volume ?? 0;
  const reason = getOhlcvIssue(row.open, row.high, row.low, row.close, volume);
  if (reason !== null) {
    return reason;
  }
  return {
    time,
    open: row.open as number,
    high: row.high as number,
    low: row.low as number,
    close: row.close as number,
    volume: volume as number,
  };
}

/**
 * Produces an engine-ready dataset from untrusted input:
 * invalid rows are dropped, times converted to Unix ms, rows sorted
 * ascending and deduplicated by time (the **last** occurrence in input
 * order wins, matching "latest update wins" semantics of market feeds).
 *
 * Runs in O(n) for already-sorted input, O(n log n) otherwise.
 * The input array and its rows are never mutated.
 */
export function normalizeCandles(
  input: readonly unknown[],
  options: NormalizeCandlesOptions = {}
): NormalizeCandlesResult {
  const timeFactor = options.timeUnit === 's' ? MS_PER_SECOND : 1;
  const issues: CandleIssue[] = [];
  const rows: IndexedCandle[] = [];
  let sorted = true;
  let lastTime = -1;

  for (let index = 0; index < input.length; index++) {
    const result = toCandle(input[index], timeFactor);
    if (typeof result === 'string') {
      issues.push({ index, reason: result });
      continue;
    }
    if (result.time < lastTime) {
      sorted = false;
    }
    lastTime = result.time;
    rows.push({ index, candle: result });
  }

  if (!sorted) {
    // Array.prototype.sort is stable, so equal times keep input order.
    rows.sort((a, b) => a.candle.time - b.candle.time);
  }

  const candles: Candle[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as IndexedCandle;
    const next = rows[i + 1];
    if (next !== undefined && next.candle.time === row.candle.time) {
      issues.push({ index: row.index, reason: 'DUPLICATE_TIME' });
      continue;
    }
    candles.push(row.candle);
  }

  if (issues.length > 1) {
    issues.sort((a, b) => a.index - b.index);
  }
  return { candles, issues };
}
