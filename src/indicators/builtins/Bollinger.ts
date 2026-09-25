import type { PriceSource } from '../Indicator';
import {
  formatIndicatorLabel,
  paramDefaults,
  periodParam,
  resolveNumberParam,
  resolveSourceParam,
  sourceParam,
  type NumberParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import {
  copyWindowSums,
  createWindowSums,
  stepWindowSums,
  type WindowSums,
} from './WindowSums';

/**
 * Bollinger Bands (spec §14.4, Phase 8.4): middle = SMA(period), upper /
 * lower = middle ± stdDev × σ, with the **population** standard deviation
 * of the window (divide by `period`, like TradingView's `ta.stdev`).
 * O(1) per tick from rolling sum / sum of squares.
 */
export interface BollingerConfig {
  period: number;
  /** Band width multiplier (`> 0`). */
  stdDev: number;
  source: PriceSource;
}

/** Output column order. */
export const BOLLINGER_UPPER = 0;
export const BOLLINGER_MIDDLE = 1;
export const BOLLINGER_LOWER = 2;

const PERIOD = periodParam(20);
const SOURCE = sourceParam('close');
const STD_DEV: NumberParam = {
  key: 'stdDev',
  label: 'StdDev',
  kind: 'number',
  min: 0.001,
  max: 50,
  step: 0.1,
  default: 2,
};
const PARAMS = [PERIOD, STD_DEV, SOURCE];

const scratch = createWindowSums();

/**
 * Variances below this fraction of the window's mean square (relative to
 * `shift`) are rounding residue of the rolling sums, not signal: without
 * the floor a flat window would get a width of `√noise` instead of 0.
 */
const VARIANCE_EPSILON = 1e-10;

export const bollingerKernel: StepKernel<BollingerConfig, WindowSums> = {
  type: 'bollinger',
  outputs: 3,
  init: createWindowSums,
  step(state, input, i, { period, stdDev, source }, outputs, commit) {
    const next = scratch;
    stepWindowSums(state, input, i, period, source, next);
    const upper = outputs[BOLLINGER_UPPER] as Float64Array;
    const middle = outputs[BOLLINGER_MIDDLE] as Float64Array;
    const lower = outputs[BOLLINGER_LOWER] as Float64Array;
    if (i >= period - 1 && next.nan === 0) {
      const mean = next.sum / period;
      const meanSq = next.sumSq / period;
      const variance = meanSq - mean * mean;
      const width =
        variance > meanSq * VARIANCE_EPSILON ? stdDev * Math.sqrt(variance) : 0;
      const basis = next.shift + mean;
      middle[i] = basis;
      upper[i] = basis + width;
      lower[i] = basis - width;
    } else {
      middle[i] = NaN;
      upper[i] = NaN;
      lower[i] = NaN;
    }
    if (commit) {
      copyWindowSums(next, state);
    }
  },
};

const meta: IndicatorMeta = {
  type: 'bollinger',
  name: 'Bollinger Bands',
  shortName: 'BB',
  placement: 'overlay',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [
    { key: 'upper', name: 'Upper' },
    { key: 'middle', name: 'Basis' },
    { key: 'lower', name: 'Lower' },
  ],
  series: [
    { kind: 'line', name: 'Basis', output: BOLLINGER_MIDDLE },
    {
      kind: 'band',
      name: 'Bands',
      upper: BOLLINGER_UPPER,
      lower: BOLLINGER_LOWER,
    },
  ],
};

export const bollingerModule: IndicatorModule<BollingerConfig> = {
  meta,
  indicator: createStepIndicator(bollingerKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    period: resolveNumberParam(raw, PERIOD),
    stdDev: resolveNumberParam(raw, STD_DEV),
    source: resolveSourceParam(raw, SOURCE),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
};
