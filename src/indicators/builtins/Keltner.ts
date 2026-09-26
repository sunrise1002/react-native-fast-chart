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
import { readSource } from '../IndicatorSeries';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import { trueRange } from './Atr';
import {
  CHANNEL_BASIS,
  CHANNEL_LOWER,
  CHANNEL_UPPER,
  channelSeries,
} from './Donchian';
import {
  createSeededAverage,
  emaAlpha,
  rmaAlpha,
  stepSeededAverage,
  type SeededAverageState,
} from './SeededAverage';
import { lengthParam } from './Stochastic';

/**
 * Keltner Channels, TradingView "KC" with its defaults (exponential MA,
 * "Average True Range" band style): `basis = EMA(source, n)`,
 * `upper / lower = basis ± multiplier · ATR(atrPeriod)` with `ATR` the
 * Wilder average of the true range (`ta.atr`). Defaults `n = 20`,
 * multiplier 2, ATR length 10, `close`. Overlay band. O(1) per tick.
 */
export interface KeltnerConfig {
  period: number;
  multiplier: number;
  atrPeriod: number;
  source: PriceSource;
}

export interface KeltnerState {
  basis: SeededAverageState;
  atr: SeededAverageState;
  /** Close of the last committed bar with a finite true range. */
  prevClose: number;
}

const PERIOD = periodParam(20);
const MULTIPLIER: NumberParam = {
  key: 'multiplier',
  label: 'Multiplier',
  kind: 'number',
  min: 0.001,
  max: 50,
  step: 0.1,
  default: 2,
};
const ATR_PERIOD = lengthParam('atrPeriod', 'ATR Length', 10);
const SOURCE = sourceParam('close');
const PARAMS = [PERIOD, MULTIPLIER, ATR_PERIOD, SOURCE];

export const keltnerKernel: StepKernel<KeltnerConfig, KeltnerState> = {
  type: 'keltner',
  outputs: 3,
  init: () => ({
    basis: createSeededAverage(),
    atr: createSeededAverage(),
    prevClose: NaN,
  }),
  step(state, input, i, config, outputs, commit) {
    const { period, multiplier, atrPeriod } = config;
    const basis = stepSeededAverage(
      state.basis,
      readSource(input, i, config.source),
      period,
      emaAlpha(period),
      commit
    );
    const tr = trueRange(input, i, state.prevClose);
    const atr = stepSeededAverage(
      state.atr,
      tr,
      atrPeriod,
      rmaAlpha(atrPeriod),
      commit
    );
    const close = input.close[input.offset + i] as number;
    if (commit && tr - tr === 0 && close - close === 0) {
      state.prevClose = close;
    }
    const width = multiplier * atr;
    (outputs[CHANNEL_BASIS] as Float64Array)[i] = basis;
    (outputs[CHANNEL_UPPER] as Float64Array)[i] = basis + width;
    (outputs[CHANNEL_LOWER] as Float64Array)[i] = basis - width;
  },
};

const meta: IndicatorMeta = {
  type: 'keltner',
  name: 'Keltner Channels',
  shortName: 'KC',
  placement: 'overlay',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  ...channelSeries('#2962FF', '#2962FF'),
};

export const keltnerModule: IndicatorModule<KeltnerConfig> = {
  meta,
  indicator: createStepIndicator(keltnerKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    period: resolveNumberParam(raw, PERIOD),
    multiplier: resolveNumberParam(raw, MULTIPLIER),
    atrPeriod: resolveNumberParam(raw, ATR_PERIOD),
    source: resolveSourceParam(raw, SOURCE),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
};
