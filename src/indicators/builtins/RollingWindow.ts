/**
 * The last `period` values of a derived per-bar series (not a candle
 * column), kept in a ring buffer with their running sum. Shared by the
 * smoothing SMAs of Stochastic / Stochastic RSI, the money-flow sums of
 * MFI and the CCI window.
 *
 * - O(1) per bar for the sum; the ring gives O(p) access to the window
 *   (CCI mean deviation).
 * - Peek / commit: `peekWindowSum` includes a candidate value without
 *   touching the state; `commitWindow` folds it in.
 * - Every `RESYNC_INTERVAL` commits (by commit count, identical for full
 *   and incremental runs) the sum is recomputed from the ring, bounding
 *   floating-point drift.
 * - Non-finite values are counted, not summed: a window holding one has
 *   no value (Pine `na` semantics of `ta.sma` / `math.sum`).
 */
import { RESYNC_INTERVAL } from './WindowSums';

export interface RollingWindowState {
  readonly period: number;
  /** Ring of the last `period` committed values (`ring[n % period]`). */
  readonly ring: Float64Array;
  /** Values committed so far. */
  count: number;
  /** Σ finite values in the ring. */
  sum: number;
  /** Non-finite values in the ring. */
  invalid: number;
}

export function createRollingWindow(period: number): RollingWindowState {
  return {
    period,
    ring: new Float64Array(period),
    count: 0,
    sum: 0,
    invalid: 0,
  };
}

/** Value that leaves the window when the next one enters (`NaN`-safe). */
function leaving(state: RollingWindowState): number {
  return state.count >= state.period
    ? (state.ring[state.count % state.period] as number)
    : 0;
}

/**
 * Sum of the window made of the last `period − 1` committed values plus
 * `x`; `NaN` while fewer than `period` values exist or any is non-finite.
 */
export function peekWindowSum(state: RollingWindowState, x: number): number {
  if (state.count + 1 < state.period || !(x - x === 0)) {
    return NaN;
  }
  const out = leaving(state);
  const outFinite = out - out === 0;
  if (state.invalid - (outFinite ? 0 : 1) > 0) {
    return NaN;
  }
  return state.sum - (outFinite ? out : 0) + x;
}

/** Mean of the peeked window (`peekWindowSum / period`). */
export function peekWindowMean(state: RollingWindowState, x: number): number {
  return peekWindowSum(state, x) / state.period;
}

/** Folds `x` into the window. */
export function commitWindow(state: RollingWindowState, x: number): void {
  const { period, ring } = state;
  const out = leaving(state);
  if (out - out === 0) {
    state.sum -= out;
  } else {
    state.invalid--;
  }
  ring[state.count % period] = x;
  if (x - x === 0) {
    state.sum += x;
  } else {
    state.invalid++;
  }
  state.count++;
  if (state.count % RESYNC_INTERVAL === 0) {
    let sum = 0;
    const filled = state.count < period ? state.count : period;
    for (let k = 0; k < filled; k++) {
      const v = ring[k] as number;
      if (v - v === 0) {
        sum += v;
      }
    }
    state.sum = sum;
  }
}

/**
 * Value `age` steps back in the peeked window (`0` = the candidate `x`,
 * `1` = the last committed value, …, `period − 1` = the oldest). Callers
 * check that the window is complete (`peekWindowSum` is finite).
 */
export function windowValue(
  state: RollingWindowState,
  x: number,
  age: number
): number {
  if (age === 0) {
    return x;
  }
  const { period } = state;
  return state.ring[(state.count - age + period * 2) % period] as number;
}

/** Peeked window mean, then commit when `commit` (SMA of a series). */
export function stepWindowMean(
  state: RollingWindowState,
  x: number,
  commit: boolean
): number {
  const mean = peekWindowMean(state, x);
  if (commit) {
    commitWindow(state, x);
  }
  return mean;
}
