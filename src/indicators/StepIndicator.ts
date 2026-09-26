import type { CandleColumns } from '../data/CandleBuffer';
import {
  DEFAULT_INDICATOR_CONTEXT,
  type Indicator,
  type IndicatorContext,
  type IndicatorResult,
} from './Indicator';
import {
  createIndicatorResult,
  ensureResultCapacity,
  growCapacity,
} from './IndicatorSeries';

/**
 * A recursive indicator expressed as one step per bar.
 *
 * `step` computes bar `i` from the state folded over bars `[0, i)` and
 * writes `outputs[k][i]`. With `commit === true` it also folds bar `i`
 * into `state`; with `commit === false` it must leave `state` untouched
 * (a "peek" used for the still-forming last bar).
 */
export interface StepKernel<TConfig, TState> {
  readonly type: string;
  /** Number of output columns. */
  readonly outputs: number;
  /**
   * Fresh state (no bar folded in yet). `context` carries chart-level
   * inputs (time zone); it only changes through a full recalculation.
   */
  init(config: TConfig, context: IndicatorContext): TState;
  step(
    state: TState,
    input: CandleColumns,
    i: number,
    config: TConfig,
    outputs: Float64Array[],
    commit: boolean
  ): void;
}

/**
 * Builds an `Indicator` with exact incremental updates from a kernel.
 *
 * Invariant after every compute: bars `[0, length - 1)` are committed and
 * the last bar is peeked. An update from `changedIndex >= committed`
 * (updateLast, append, tail patch) commits the newly closed bars and peeks
 * the new last bar — O(changed bars), usually O(1). Because the full
 * calculation runs the very same step sequence, incremental results are
 * bit-identical to a full recalculation. Earlier changes, shrinking input
 * and prepends fall back to `calculate` (spec §15.3).
 */
export function createStepIndicator<TConfig, TState>(
  kernel: StepKernel<TConfig, TState>
): Indicator<TConfig, IndicatorResult<TState>> {
  function advance(
    result: IndicatorResult<TState>,
    input: CandleColumns,
    config: TConfig
  ): void {
    const n = input.length;
    ensureResultCapacity(result, n);
    const { outputs, state } = result;
    for (let i = result.committed; i < n - 1; i++) {
      kernel.step(state, input, i, config, outputs, true);
    }
    if (n > 0) {
      kernel.step(state, input, n - 1, config, outputs, false);
    }
    result.length = n;
    result.committed = n > 0 ? n - 1 : 0;
  }

  function calculate(
    input: CandleColumns,
    config: TConfig,
    context: IndicatorContext = DEFAULT_INDICATOR_CONTEXT
  ): IndicatorResult<TState> {
    const n = input.length > 0 ? input.length : 0;
    const result = createIndicatorResult(
      kernel.outputs,
      growCapacity(n),
      kernel.init(config, context)
    );
    advance(result, input, config);
    result.changedFrom = 0;
    return result;
  }

  function update(
    previous: IndicatorResult<TState>,
    input: CandleColumns,
    changedIndex: number,
    config: TConfig,
    context?: IndicatorContext
  ): IndicatorResult<TState> {
    if (
      !(changedIndex >= previous.committed) ||
      input.length < previous.length
    ) {
      return calculate(input, config, context);
    }
    const from = previous.committed;
    advance(previous, input, config);
    previous.changedFrom = from;
    return previous;
  }

  return { type: kernel.type, calculate, update };
}
