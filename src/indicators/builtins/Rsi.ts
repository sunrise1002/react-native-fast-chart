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
import { isFiniteValue, readSource } from '../IndicatorSeries';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import {
  createSeededAverage,
  rmaAlpha,
  stepSeededAverage,
  type SeededAverageState,
} from './SeededAverage';

/**
 * Relative Strength Index (spec §14.5, Phase 11) with Wilder smoothing,
 * matching TradingView `ta.rsi`: `change = x_t − x_(t−1)`, average gain /
 * loss = RMA(period) seeded with the SMA of the first `period` changes,
 * `RSI = 100 − 100 / (1 + gain / loss)` (100 when there is no loss —
 * including a flat window, like Pine — and 0 when there is no gain). The first value is at bar
 * `period`. O(1) per tick. A non-finite input yields `NaN` and is skipped:
 * the next change is taken against the last finite value.
 */
export interface RsiConfig {
  period: number;
  source: PriceSource;
  /** Upper guide / band level (default 70). */
  overbought: number;
  /** Lower guide / band level (default 30). */
  oversold: number;
}

export interface RsiState {
  /** Last committed finite source value (`NaN` before the first). */
  prev: number;
  gain: SeededAverageState;
  loss: SeededAverageState;
}

const PERIOD = periodParam(14);
const SOURCE = sourceParam('close');
function levelParam(key: string, label: string, value: number): NumberParam {
  return {
    key,
    label,
    kind: 'number',
    min: 0,
    max: 100,
    step: 1,
    default: value,
  };
}
const OVERBOUGHT = levelParam('overbought', 'Upper Band', 70);
const OVERSOLD = levelParam('oversold', 'Lower Band', 30);
const PARAMS = [PERIOD, SOURCE, OVERBOUGHT, OVERSOLD];

/** RSI from average gain / loss (both finite, `>= 0`). */
export function rsiFromAverages(gain: number, loss: number): number {
  if (loss === 0) {
    return 100;
  }
  if (gain === 0) {
    return 0;
  }
  return 100 - 100 / (1 + gain / loss);
}

export const rsiKernel: StepKernel<RsiConfig, RsiState> = {
  type: 'rsi',
  outputs: 1,
  init: () => ({
    prev: NaN,
    gain: createSeededAverage(),
    loss: createSeededAverage(),
  }),
  step(state, input, i, { period, source }, outputs, commit) {
    const out = outputs[0] as Float64Array;
    const x = readSource(input, i, source);
    if (!isFiniteValue(x)) {
      out[i] = NaN;
      return;
    }
    if (Number.isNaN(state.prev)) {
      out[i] = NaN;
      if (commit) {
        state.prev = x;
      }
      return;
    }
    const change = x - state.prev;
    const alpha = rmaAlpha(period);
    const gain = stepSeededAverage(
      state.gain,
      change > 0 ? change : 0,
      period,
      alpha,
      commit
    );
    const loss = stepSeededAverage(
      state.loss,
      change < 0 ? -change : 0,
      period,
      alpha,
      commit
    );
    out[i] = Number.isNaN(gain) ? NaN : rsiFromAverages(gain, loss);
    if (commit) {
      state.prev = x;
    }
  },
};

const meta: IndicatorMeta = {
  type: 'rsi',
  name: 'Relative Strength Index',
  shortName: 'RSI',
  placement: 'pane',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [{ key: 'rsi', name: 'RSI' }],
  series: [{ kind: 'line', name: 'RSI', output: 0, defaultColor: '#7E57C2' }],
  scale: { kind: 'fixed', min: 0, max: 100 },
  valueFormat: { decimals: 2 },
};

export const rsiModule: IndicatorModule<RsiConfig> = {
  meta,
  indicator: createStepIndicator(rsiKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    period: resolveNumberParam(raw, PERIOD),
    source: resolveSourceParam(raw, SOURCE),
    overbought: resolveNumberParam(raw, OVERBOUGHT),
    oversold: resolveNumberParam(raw, OVERSOLD),
  }),
  formatLabel: ({ period, source }) =>
    formatIndicatorLabel(meta.shortName, [PERIOD, SOURCE], { period, source }),
  guides: ({ overbought, oversold }) => {
    const upper = Math.max(overbought, oversold);
    const lower = Math.min(overbought, oversold);
    return { levels: [upper, 50, lower], band: { upper, lower } };
  },
};
