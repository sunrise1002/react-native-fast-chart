import type { CandleColumns } from '../../data/CandleBuffer';
import {
  formatIndicatorLabel,
  paramDefaults,
  periodParam,
  resolveNumberParam,
  type NumberParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import type {
  IndicatorGuides,
  IndicatorMeta,
  IndicatorModule,
} from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import {
  createRollingExtreme,
  stepExtreme,
  type RollingExtremeState,
} from './RollingExtremes';
import {
  createRollingWindow,
  stepWindowMean,
  type RollingWindowState,
} from './RollingWindow';

/**
 * Stochastic Oscillator, TradingView "Stoch" (`ta.stoch`):
 *
 * - `raw = 100 · (close − LL) / (HH − LL)` with `HH` / `LL` the highest
 *   high / lowest low of the last `kPeriod` bars (`NaN` when `HH = LL`,
 *   Pine's division by zero);
 * - `%K = SMA(raw, kSmoothing)`, `%D = SMA(%K, dSmoothing)`.
 *
 * Defaults 14 / 1 / 3. Pane indicator on a fixed 0–100 scale with 80 / 20
 * guides. O(1) per tick (monotonic deques + ring sums).
 */
export interface StochasticConfig {
  kPeriod: number;
  kSmoothing: number;
  dSmoothing: number;
}

export interface StochasticState {
  highest: RollingExtremeState;
  lowest: RollingExtremeState;
  k: RollingWindowState;
  d: RollingWindowState;
}

/** Output column order (shared with Stochastic RSI). */
export const STOCH_K = 0;
export const STOCH_D = 1;

/** Integer length param with its own key / label. */
export function lengthParam(
  key: string,
  label: string,
  value: number
): NumberParam {
  return { ...periodParam(value), key, label };
}

const K_PERIOD = lengthParam('kPeriod', '%K Length', 14);
const K_SMOOTHING = lengthParam('kSmoothing', '%K Smoothing', 1);
const D_SMOOTHING = lengthParam('dSmoothing', '%D Smoothing', 3);
const PARAMS = [K_PERIOD, K_SMOOTHING, D_SMOOTHING];

/** `100 · (x − low) / (high − low)`; `NaN` for an empty range. */
export function stochValue(x: number, high: number, low: number): number {
  const range = high - low;
  return range > 0 ? (100 * (x - low)) / range : NaN;
}

/** %K / %D smoothing of a raw stochastic value (writes bar `i`). */
export function stepStochSmoothing(
  k: RollingWindowState,
  d: RollingWindowState,
  raw: number,
  i: number,
  outputs: Float64Array[],
  commit: boolean
): void {
  const kValue = stepWindowMean(k, raw, commit);
  (outputs[STOCH_K] as Float64Array)[i] = kValue;
  (outputs[STOCH_D] as Float64Array)[i] = stepWindowMean(d, kValue, commit);
}

export const stochasticKernel: StepKernel<StochasticConfig, StochasticState> = {
  type: 'stochastic',
  outputs: 2,
  init: ({ kPeriod, kSmoothing, dSmoothing }) => ({
    highest: createRollingExtreme(kPeriod, 1),
    lowest: createRollingExtreme(kPeriod, -1),
    k: createRollingWindow(kSmoothing),
    d: createRollingWindow(dSmoothing),
  }),
  step(state, input: CandleColumns, i, _config, outputs, commit) {
    const p = input.offset + i;
    const high = stepExtreme(state.highest, i, input.high[p] as number, commit);
    const low = stepExtreme(state.lowest, i, input.low[p] as number, commit);
    const raw = stochValue(input.close[p] as number, high, low);
    stepStochSmoothing(state.k, state.d, raw, i, outputs, commit);
  },
};

/** 80 / 50 / 20 guides with the 20–80 zone filled (TradingView). */
export const STOCH_GUIDES: IndicatorGuides = Object.freeze({
  levels: Object.freeze([80, 50, 20]),
  band: Object.freeze({ upper: 80, lower: 20 }),
});

/** TradingView %K / %D colors. */
export const STOCH_K_COLOR = '#2962FF';
export const STOCH_D_COLOR = '#FF6D00';

const meta: IndicatorMeta = {
  type: 'stochastic',
  name: 'Stochastic',
  shortName: 'Stoch',
  placement: 'pane',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [
    { key: 'k', name: '%K' },
    { key: 'd', name: '%D' },
  ],
  series: [
    { kind: 'line', name: '%K', output: STOCH_K, defaultColor: STOCH_K_COLOR },
    { kind: 'line', name: '%D', output: STOCH_D, defaultColor: STOCH_D_COLOR },
  ],
  scale: { kind: 'fixed', min: 0, max: 100 },
  valueFormat: { decimals: 2 },
};

export const stochasticModule: IndicatorModule<StochasticConfig> = {
  meta,
  indicator: createStepIndicator(stochasticKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    kPeriod: resolveNumberParam(raw, K_PERIOD),
    kSmoothing: resolveNumberParam(raw, K_SMOOTHING),
    dSmoothing: resolveNumberParam(raw, D_SMOOTHING),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
  guides: () => STOCH_GUIDES,
};
