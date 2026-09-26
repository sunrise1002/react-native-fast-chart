import type { PriceSource } from '../Indicator';
import {
  formatIndicatorLabel,
  paramDefaults,
  resolveNumberParam,
  resolveSourceParam,
  sourceParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import { readSource } from '../IndicatorSeries';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import {
  createRollingExtreme,
  stepExtreme,
  type RollingExtremeState,
} from './RollingExtremes';
import { createRollingWindow, type RollingWindowState } from './RollingWindow';
import { createRsiState, stepRsi, type RsiState } from './Rsi';
import {
  lengthParam,
  STOCH_D,
  STOCH_D_COLOR,
  STOCH_GUIDES,
  STOCH_K,
  STOCH_K_COLOR,
  stepStochSmoothing,
  stochValue,
} from './Stochastic';

/**
 * Stochastic RSI, TradingView "Stoch RSI":
 *
 * - `rsi = RSI(source, rsiPeriod)` (Wilder, as the RSI indicator);
 * - `raw = 100 · (rsi − lowest(rsi)) / (highest(rsi) − lowest(rsi))` over
 *   the last `stochPeriod` bars (`NaN` for a flat window);
 * - `%K = SMA(raw, kSmoothing)`, `%D = SMA(%K, dSmoothing)`.
 *
 * Defaults 3 / 3 / 14 / 14 on `close`. A window containing a warm-up
 * (`NaN`) RSI has no value, so the first %K appears at bar
 * `rsiPeriod + stochPeriod + kSmoothing − 2`. O(1) per tick.
 */
export interface StochRsiConfig {
  kSmoothing: number;
  dSmoothing: number;
  rsiPeriod: number;
  stochPeriod: number;
  source: PriceSource;
}

export interface StochRsiState {
  rsi: RsiState;
  highest: RollingExtremeState;
  lowest: RollingExtremeState;
  k: RollingWindowState;
  d: RollingWindowState;
}

const K_SMOOTHING = lengthParam('kSmoothing', 'K', 3);
const D_SMOOTHING = lengthParam('dSmoothing', 'D', 3);
const RSI_PERIOD = lengthParam('rsiPeriod', 'RSI Length', 14);
const STOCH_PERIOD = lengthParam('stochPeriod', 'Stochastic Length', 14);
const SOURCE = sourceParam('close');
const PARAMS = [K_SMOOTHING, D_SMOOTHING, RSI_PERIOD, STOCH_PERIOD, SOURCE];

export const stochRsiKernel: StepKernel<StochRsiConfig, StochRsiState> = {
  type: 'stochRsi',
  outputs: 2,
  init: ({ kSmoothing, dSmoothing, stochPeriod }) => ({
    rsi: createRsiState(),
    highest: createRollingExtreme(stochPeriod, 1),
    lowest: createRollingExtreme(stochPeriod, -1),
    k: createRollingWindow(kSmoothing),
    d: createRollingWindow(dSmoothing),
  }),
  step(state, input, i, { rsiPeriod, source }, outputs, commit) {
    const rsi = stepRsi(
      state.rsi,
      readSource(input, i, source),
      rsiPeriod,
      commit
    );
    const high = stepExtreme(state.highest, i, rsi, commit);
    const low = stepExtreme(state.lowest, i, rsi, commit);
    const raw = stochValue(rsi, high, low);
    stepStochSmoothing(state.k, state.d, raw, i, outputs, commit);
  },
};

const meta: IndicatorMeta = {
  type: 'stochRsi',
  name: 'Stochastic RSI',
  shortName: 'Stoch RSI',
  placement: 'pane',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [
    { key: 'k', name: 'K' },
    { key: 'd', name: 'D' },
  ],
  series: [
    { kind: 'line', name: 'K', output: STOCH_K, defaultColor: STOCH_K_COLOR },
    { kind: 'line', name: 'D', output: STOCH_D, defaultColor: STOCH_D_COLOR },
  ],
  scale: { kind: 'fixed', min: 0, max: 100 },
  valueFormat: { decimals: 2 },
};

export const stochRsiModule: IndicatorModule<StochRsiConfig> = {
  meta,
  indicator: createStepIndicator(stochRsiKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    kSmoothing: resolveNumberParam(raw, K_SMOOTHING),
    dSmoothing: resolveNumberParam(raw, D_SMOOTHING),
    rsiPeriod: resolveNumberParam(raw, RSI_PERIOD),
    stochPeriod: resolveNumberParam(raw, STOCH_PERIOD),
    source: resolveSourceParam(raw, SOURCE),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
  guides: () => STOCH_GUIDES,
};
