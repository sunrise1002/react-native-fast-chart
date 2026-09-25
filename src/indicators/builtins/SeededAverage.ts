/**
 * Exponential smoothing seeded with a simple average, shared by EMA, the
 * Wilder averages of RSI / ATR (RMA) and the MACD lines.
 *
 * The first value is the SMA of the first `period` finite inputs (Pine
 * `ta.ema` / `ta.rma` seeding), afterwards
 * `value_t = x_t·alpha + value_(t−1)·(1 − alpha)`. Non-finite inputs yield
 * `NaN` and leave the state untouched (the recursion continues from the
 * previous value). With `commit === false` the step is a pure peek.
 */
export interface SeededAverageState {
  /** Average of the last committed finite input (after seeding). */
  value: number;
  /** Sum / count of the finite inputs collected while seeding. */
  seedSum: number;
  seedCount: number;
}

export function createSeededAverage(): SeededAverageState {
  return { value: NaN, seedSum: 0, seedCount: 0 };
}

/** EMA smoothing factor `2 / (period + 1)`. */
export function emaAlpha(period: number): number {
  return 2 / (period + 1);
}

/** Wilder (RMA) smoothing factor `1 / period`. */
export function rmaAlpha(period: number): number {
  return 1 / period;
}

/** Average including `x`; folds `x` into `state` only when `commit`. */
export function stepSeededAverage(
  state: SeededAverageState,
  x: number,
  period: number,
  alpha: number,
  commit: boolean
): number {
  if (!(x - x === 0)) {
    return NaN;
  }
  if (state.seedCount < period) {
    const sum = state.seedSum + x;
    const count = state.seedCount + 1;
    const value = count === period ? sum / period : NaN;
    if (commit) {
      state.seedSum = sum;
      state.seedCount = count;
      state.value = value;
    }
    return value;
  }
  const value = x * alpha + state.value * (1 - alpha);
  if (commit) {
    state.value = value;
  }
  return value;
}
