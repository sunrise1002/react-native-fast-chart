/**
 * Rolling highest / lowest value over the last `period` bars (Pine
 * `ta.highest` / `ta.lowest`), shared by Stochastic, Stochastic RSI,
 * Donchian Channels and Ichimoku.
 *
 * A monotonic deque of `(bar, value)` pairs over the committed bars keeps
 * the extreme of the window at its front: O(1) amortized per committed
 * bar, O(1) per peek, independent of `period`. The deque lives in two
 * ring buffers of `period + 1` slots (no per-bar allocation).
 *
 * Peek / commit: `peekExtreme` evaluates bar `i` without touching the
 * state (the still-forming last bar); `commitExtreme` folds it in. Bars
 * must be committed in increasing order. A non-finite value makes every
 * window containing it `NaN` (Pine `na` semantics as in `ta.sma`).
 */
export interface RollingExtremeState {
  readonly period: number;
  /** `+1` = highest, `-1` = lowest. */
  readonly sign: 1 | -1;
  readonly bars: Float64Array;
  readonly values: Float64Array;
  /** Ring position of the deque front. */
  head: number;
  size: number;
  /** Last committed bar with a non-finite value (`-Infinity` = none). */
  lastInvalid: number;
}

export function createRollingExtreme(
  period: number,
  sign: 1 | -1
): RollingExtremeState {
  const slots = period + 1;
  return {
    period,
    sign,
    bars: new Float64Array(slots),
    values: new Float64Array(slots),
    head: 0,
    size: 0,
    lastInvalid: -Infinity,
  };
}

/** `true` when `a` is at least as extreme as `b` for the state's sign. */
function dominates(sign: 1 | -1, a: number, b: number): boolean {
  return sign > 0 ? a >= b : a <= b;
}

/**
 * Extreme of the window ending at bar `i` whose value is `x`, given the
 * bars `< i` committed so far. `NaN` while the window is incomplete
 * (`i < period − 1`) or contains a non-finite value.
 */
export function peekExtreme(
  state: RollingExtremeState,
  i: number,
  x: number
): number {
  const { period } = state;
  if (!(x - x === 0) || i < period - 1 || state.lastInvalid > i - period) {
    return NaN;
  }
  // Committed bars left in the deque are all inside this window.
  if (state.size > 0) {
    const front = state.values[state.head] as number;
    return dominates(state.sign, front, x) ? front : x;
  }
  return x;
}

/** Folds bar `i` (value `x`) into the window. */
export function commitExtreme(
  state: RollingExtremeState,
  i: number,
  x: number
): void {
  const slots = state.period + 1;
  if (x - x === 0) {
    // Drop dominated values from the back, then append.
    while (state.size > 0) {
      const back = (state.head + state.size - 1) % slots;
      if (!dominates(state.sign, x, state.values[back] as number)) {
        break;
      }
      state.size--;
    }
    const slot = (state.head + state.size) % slots;
    state.bars[slot] = i;
    state.values[slot] = x;
    state.size++;
  } else {
    state.lastInvalid = i;
  }
  // Expire bars that can't be in the window of bar `i + 1`.
  while (
    state.size > 0 &&
    (state.bars[state.head] as number) <= i + 1 - state.period
  ) {
    state.head = (state.head + 1) % slots;
    state.size--;
  }
}

/** Peek, then commit when `commit` (the common kernel pattern). */
export function stepExtreme(
  state: RollingExtremeState,
  i: number,
  x: number,
  commit: boolean
): number {
  const value = peekExtreme(state, i, x);
  if (commit) {
    commitExtreme(state, i, x);
  }
  return value;
}
