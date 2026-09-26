import {
  formatIndicatorLabel,
  paramDefaults,
  resolveNumberParam,
  type NumberParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';

/**
 * Parabolic SAR, TradingView "Parabolic SAR" (`ta.sar(start, increment,
 * maximum)`, Wilder):
 *
 * - on the second bar the trend starts up when `close > close[1]` (SAR =
 *   `low[1]`, extreme point = `high`) and down otherwise (SAR =
 *   `high[1]`, EP = `low`); acceleration = `start`;
 * - each bar `SAR += AF · (EP − SAR)`; a SAR crossing the bar reverses the
 *   trend (SAR = the old EP bounded by the bar, EP = the opposite
 *   extreme, AF = `start`);
 * - otherwise a new extreme moves EP and raises AF by `increment` up to
 *   `maximum`;
 * - an up-trend SAR never exceeds the previous two lows (down-trend: the
 *   previous two highs).
 *
 * Bars with a non-finite high / low / close have no value and are
 * skipped. Defaults 0.02 / 0.02 / 0.2. Overlay drawn as dots. O(1) per
 * tick.
 */
export interface ParabolicSarConfig {
  start: number;
  increment: number;
  maximum: number;
}

export interface ParabolicSarState {
  /** Valid bars committed so far (Pine `bar_index` over valid bars). */
  bars: number;
  sar: number;
  extreme: number;
  acceleration: number;
  /** `true` = up-trend (SAR below the price). */
  rising: boolean;
  /** High / low / close of the last two committed valid bars. */
  high1: number;
  low1: number;
  close1: number;
  high2: number;
  low2: number;
}

function factorParam(key: string, label: string, value: number): NumberParam {
  return {
    key,
    label,
    kind: 'number',
    min: 0.001,
    max: 1,
    step: 0.01,
    default: value,
  };
}
const START = factorParam('start', 'Start', 0.02);
const INCREMENT = factorParam('increment', 'Increment', 0.02);
const MAXIMUM = factorParam('maximum', 'Max Value', 0.2);
const PARAMS = [START, INCREMENT, MAXIMUM];

export const parabolicSarKernel: StepKernel<
  ParabolicSarConfig,
  ParabolicSarState
> = {
  type: 'parabolicSar',
  outputs: 1,
  init: () => ({
    bars: 0,
    sar: NaN,
    extreme: NaN,
    acceleration: NaN,
    rising: false,
    high1: NaN,
    low1: NaN,
    close1: NaN,
    high2: NaN,
    low2: NaN,
  }),
  step(state, input, i, { start, increment, maximum }, outputs, commit) {
    const p = input.offset + i;
    const high = input.high[p] as number;
    const low = input.low[p] as number;
    const close = input.close[p] as number;
    const out = outputs[0] as Float64Array;
    const range = high - low;
    if (!(range - range === 0) || !(close - close === 0)) {
      out[i] = NaN;
      return;
    }
    let { sar, extreme, acceleration, rising } = state;
    if (state.bars === 0) {
      out[i] = NaN;
    } else {
      let firstTrendBar = false;
      if (state.bars === 1) {
        rising = close > state.close1;
        extreme = rising ? high : low;
        sar = rising ? state.low1 : state.high1;
        acceleration = start;
        firstTrendBar = true;
      }
      sar += acceleration * (extreme - sar);
      if (rising ? sar > low : sar < high) {
        firstTrendBar = true;
        sar = rising ? Math.max(high, extreme) : Math.min(low, extreme);
        rising = !rising;
        extreme = rising ? high : low;
        acceleration = start;
      }
      if (!firstTrendBar && (rising ? high > extreme : low < extreme)) {
        extreme = rising ? high : low;
        acceleration = Math.min(acceleration + increment, maximum);
      }
      if (rising) {
        sar = Math.min(sar, state.low1);
        if (state.bars > 1) {
          sar = Math.min(sar, state.low2);
        }
      } else {
        sar = Math.max(sar, state.high1);
        if (state.bars > 1) {
          sar = Math.max(sar, state.high2);
        }
      }
      out[i] = sar;
    }
    if (commit) {
      state.sar = sar;
      state.extreme = extreme;
      state.acceleration = acceleration;
      state.rising = rising;
      state.high2 = state.high1;
      state.low2 = state.low1;
      state.high1 = high;
      state.low1 = low;
      state.close1 = close;
      state.bars++;
    }
  },
};

const meta: IndicatorMeta = {
  type: 'parabolicSar',
  name: 'Parabolic SAR',
  shortName: 'SAR',
  placement: 'overlay',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [{ key: 'sar', name: 'SAR' }],
  series: [{ kind: 'points', name: 'SAR', output: 0, defaultColor: '#2962FF' }],
};

export const parabolicSarModule: IndicatorModule<ParabolicSarConfig> = {
  meta,
  indicator: createStepIndicator(parabolicSarKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    start: resolveNumberParam(raw, START),
    increment: resolveNumberParam(raw, INCREMENT),
    maximum: resolveNumberParam(raw, MAXIMUM),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
};
