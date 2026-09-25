import type { CandleColumns } from '../../data/CandleBuffer';
import {
  formatIndicatorLabel,
  paramDefaults,
  periodParam,
  resolveNumberParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import {
  createSeededAverage,
  rmaAlpha,
  stepSeededAverage,
  type SeededAverageState,
} from './SeededAverage';

/**
 * Average True Range (spec §14.7, Phase 13), TradingView `ta.atr`: Wilder
 * RMA of the true range, seeded with the SMA of the first `period` values.
 * Drawn as a generic line pane (`'auto'` scale). O(1) per tick.
 */
export interface AtrConfig {
  period: number;
}

export interface AtrState {
  /** Close of the last committed bar with a finite true range. */
  prevClose: number;
  average: SeededAverageState;
}

/**
 * True range of bar `i` given the previous close:
 * `max(high − low, |high − prevClose|, |low − prevClose|)`; plain
 * `high − low` when `prevClose` is not finite (first bar). `NaN` when the
 * bar's high / low is not finite.
 */
export function trueRange(
  input: CandleColumns,
  i: number,
  prevClose: number
): number {
  const p = input.offset + i;
  const high = input.high[p] as number;
  const low = input.low[p] as number;
  const range = high - low;
  if (!(range - range === 0)) {
    return NaN;
  }
  if (!(prevClose - prevClose === 0)) {
    return range;
  }
  const up = Math.abs(high - prevClose);
  const down = Math.abs(low - prevClose);
  return range > up ? (range > down ? range : down) : up > down ? up : down;
}

const PERIOD = periodParam(14);
const PARAMS = [PERIOD];

export const atrKernel: StepKernel<AtrConfig, AtrState> = {
  type: 'atr',
  outputs: 1,
  init: () => ({ prevClose: NaN, average: createSeededAverage() }),
  step(state, input, i, { period }, outputs, commit) {
    const tr = trueRange(input, i, state.prevClose);
    (outputs[0] as Float64Array)[i] = stepSeededAverage(
      state.average,
      tr,
      period,
      rmaAlpha(period),
      commit
    );
    const close = input.close[input.offset + i] as number;
    if (commit && tr - tr === 0 && close - close === 0) {
      state.prevClose = close;
    }
  },
};

const meta: IndicatorMeta = {
  type: 'atr',
  name: 'Average True Range',
  shortName: 'ATR',
  placement: 'pane',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [{ key: 'atr', name: 'ATR' }],
  series: [{ kind: 'line', name: 'ATR', output: 0, defaultColor: '#B71C1C' }],
  scale: { kind: 'auto' },
};

export const atrModule: IndicatorModule<AtrConfig> = {
  meta,
  indicator: createStepIndicator(atrKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    period: resolveNumberParam(raw, PERIOD),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
};
