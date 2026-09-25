import type { CandleColumns } from '../data/CandleBuffer';
import type { IndicatorResult, PriceSource } from './Indicator';

/*
 * Low-level helpers shared by indicator implementations: price source
 * reads and output column allocation / growth. Pure, allocation-free on
 * the per-bar path.
 */

/**
 * Value of `source` for bar `i` of `input` (no bounds check: callers
 * iterate valid indices). Non-finite inputs propagate as-is.
 */
export function readSource(
  input: CandleColumns,
  i: number,
  source: PriceSource
): number {
  const p = input.offset + i;
  switch (source) {
    case 'open':
      return input.open[p] as number;
    case 'high':
      return input.high[p] as number;
    case 'low':
      return input.low[p] as number;
    case 'hl2':
      return ((input.high[p] as number) + (input.low[p] as number)) / 2;
    case 'hlc3':
      return (
        ((input.high[p] as number) +
          (input.low[p] as number) +
          (input.close[p] as number)) /
        3
      );
    case 'ohlc4':
      return (
        ((input.open[p] as number) +
          (input.high[p] as number) +
          (input.low[p] as number) +
          (input.close[p] as number)) /
        4
      );
    default:
      return input.close[p] as number;
  }
}

/** Spare slots allocated beyond the current length (realtime appends). */
export function growCapacity(needed: number, current = 0): number {
  const base = Math.max(needed, Math.ceil(current * 1.5));
  return base + 64;
}

/** A `NaN`-filled column of `capacity` slots. */
export function nanColumn(capacity: number): Float64Array {
  const column = new Float64Array(capacity > 0 ? capacity : 0);
  column.fill(NaN);
  return column;
}

/** Empty result with `outputs` NaN columns of room for `capacity` bars. */
export function createIndicatorResult<TState>(
  outputs: number,
  capacity: number,
  state: TState
): IndicatorResult<TState> {
  const columns: Float64Array[] = [];
  for (let k = 0; k < outputs; k++) {
    columns.push(nanColumn(capacity));
  }
  return { outputs: columns, length: 0, committed: 0, changedFrom: 0, state };
}

/** Grows every output column to hold at least `length` bars (amortized). */
export function ensureResultCapacity(
  result: IndicatorResult<unknown>,
  length: number
): void {
  const first = result.outputs[0];
  const current = first ? first.length : 0;
  if (length <= current) {
    return;
  }
  const capacity = growCapacity(length, current);
  for (let k = 0; k < result.outputs.length; k++) {
    const next = nanColumn(capacity);
    next.set((result.outputs[k] as Float64Array).subarray(0, result.length));
    result.outputs[k] = next;
  }
}

/** `true` for finite numbers (the only values indicators aggregate). */
export function isFiniteValue(value: number): boolean {
  return value - value === 0;
}
