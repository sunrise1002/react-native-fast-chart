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
import {
  createSeededAverage,
  emaAlpha,
  stepSeededAverage,
  type SeededAverageState,
} from './SeededAverage';

/**
 * MACD (spec §14.6, Phase 12), TradingView `ta.macd`: `macd = EMA(fast) −
 * EMA(slow)`, `signal = EMA(macd, signal)` (seeded with the SMA of the
 * first `signal` MACD values), `histogram = macd − signal`. All three EMAs
 * use the shared seeded recursion, so realtime ticks cost O(1).
 */
export interface MacdConfig {
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
  source: PriceSource;
}

export interface MacdState {
  fast: SeededAverageState;
  slow: SeededAverageState;
  signal: SeededAverageState;
}

/** Output column order. */
export const MACD_LINE = 0;
export const MACD_SIGNAL = 1;
export const MACD_HISTOGRAM = 2;

function lengthParam(key: string, label: string, value: number): NumberParam {
  return { ...periodParam(value), key, label };
}
const FAST = lengthParam('fastPeriod', 'Fast Length', 12);
const SLOW = lengthParam('slowPeriod', 'Slow Length', 26);
const SIGNAL = lengthParam('signalPeriod', 'Signal Length', 9);
const SOURCE = sourceParam('close');
const PARAMS = [FAST, SLOW, SIGNAL, SOURCE];

/** TradingView histogram colors: ≥ 0 rising / falling, < 0 falling / rising. */
export const MACD_HISTOGRAM_COLORS = Object.freeze([
  '#26A69A',
  '#B2DFDB',
  '#FF5252',
  '#FFCDD2',
]);

export const macdKernel: StepKernel<MacdConfig, MacdState> = {
  type: 'macd',
  outputs: 3,
  init: () => ({
    fast: createSeededAverage(),
    slow: createSeededAverage(),
    signal: createSeededAverage(),
  }),
  step(state, input, i, config, outputs, commit) {
    const { fastPeriod, slowPeriod, signalPeriod } = config;
    const x = readSource(input, i, config.source);
    const fast = stepSeededAverage(
      state.fast,
      x,
      fastPeriod,
      emaAlpha(fastPeriod),
      commit
    );
    const slow = stepSeededAverage(
      state.slow,
      x,
      slowPeriod,
      emaAlpha(slowPeriod),
      commit
    );
    const macd = fast - slow;
    // `NaN` input (warm-up) leaves the signal recursion untouched.
    const signal = stepSeededAverage(
      state.signal,
      macd,
      signalPeriod,
      emaAlpha(signalPeriod),
      commit
    );
    (outputs[MACD_LINE] as Float64Array)[i] = macd;
    (outputs[MACD_SIGNAL] as Float64Array)[i] = signal;
    (outputs[MACD_HISTOGRAM] as Float64Array)[i] = macd - signal;
  },
};

const meta: IndicatorMeta = {
  type: 'macd',
  name: 'Moving Average Convergence Divergence',
  shortName: 'MACD',
  placement: 'pane',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [
    { key: 'macd', name: 'MACD' },
    { key: 'signal', name: 'Signal' },
    { key: 'histogram', name: 'Histogram' },
  ],
  series: [
    {
      kind: 'histogram',
      name: 'Histogram',
      output: MACD_HISTOGRAM,
      colorMode: 'trend',
      defaultColors: MACD_HISTOGRAM_COLORS,
    },
    { kind: 'line', name: 'MACD', output: MACD_LINE, defaultColor: '#2962FF' },
    {
      kind: 'line',
      name: 'Signal',
      output: MACD_SIGNAL,
      defaultColor: '#FF6D00',
    },
  ],
  scale: { kind: 'zeroCentered' },
};

export const macdModule: IndicatorModule<MacdConfig> = {
  meta,
  indicator: createStepIndicator(macdKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    fastPeriod: resolveNumberParam(raw, FAST),
    slowPeriod: resolveNumberParam(raw, SLOW),
    signalPeriod: resolveNumberParam(raw, SIGNAL),
    source: resolveSourceParam(raw, SOURCE),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
};
