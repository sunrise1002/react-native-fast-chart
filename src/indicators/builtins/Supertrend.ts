import {
  formatIndicatorLabel,
  paramDefaults,
  periodParam,
  resolveNumberParam,
  type NumberParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import { trueRange } from './Atr';
import {
  createSeededAverage,
  rmaAlpha,
  stepSeededAverage,
  type SeededAverageState,
} from './SeededAverage';

/**
 * Supertrend, TradingView "Supertrend" (`ta.supertrend(factor, atrPeriod)`):
 *
 * - `basicUpper / basicLower = hl2 ± factor · ATR(atrPeriod)` (Wilder ATR);
 * - final bands ratchet: `lower = basicLower > lower[1] || close[1] <
 *   lower[1] ? basicLower : lower[1]`, `upper = basicUpper < upper[1] ||
 *   close[1] > upper[1] ? basicUpper : upper[1]`;
 * - direction: down (`+1`) on the first bar with a previous ATR missing;
 *   after a down bar it turns up when `close > upper`, after an up bar
 *   down when `close < lower`;
 * - supertrend = `lower` in an uptrend, `upper` in a downtrend.
 *
 * Outputs split the line by direction (`NaN` elsewhere) so each trend is
 * its own colored run with a gap at a switch, like TradingView, plus the
 * candle body middle `(open + close) / 2` for the optional trend fill.
 * Defaults ATR 10, factor 3. Overlay. O(1) per tick.
 */
export interface SupertrendConfig {
  atrPeriod: number;
  factor: number;
}

export interface SupertrendState {
  atr: SeededAverageState;
  /** Close of the last committed bar with a finite true range (ATR). */
  trClose: number;
  /** Final bands of the last committed bar (`0` when undefined, `nz`). */
  upper: number;
  lower: number;
  /** Close of the last committed bar (`NaN` = none). */
  close: number;
  /** Direction of the last committed bar: `-1` up, `+1` down. */
  direction: number;
  /** ATR was defined on the last committed bar. */
  atrValid: boolean;
}

/** Output column order. */
export const SUPERTREND_UP = 0;
export const SUPERTREND_DOWN = 1;
export const SUPERTREND_MIDDLE = 2;

/** TradingView trend colors. */
export const SUPERTREND_UP_COLOR = '#26A69A';
export const SUPERTREND_DOWN_COLOR = '#EF5350';

const ATR_PERIOD = {
  ...periodParam(10),
  key: 'atrPeriod',
  label: 'ATR Length',
};
const FACTOR: NumberParam = {
  key: 'factor',
  label: 'Factor',
  kind: 'number',
  min: 0.01,
  max: 100,
  step: 0.1,
  default: 3,
};
const PARAMS = [ATR_PERIOD, FACTOR];

export const supertrendKernel: StepKernel<SupertrendConfig, SupertrendState> = {
  type: 'supertrend',
  outputs: 3,
  init: () => ({
    atr: createSeededAverage(),
    trClose: NaN,
    upper: 0,
    lower: 0,
    close: NaN,
    direction: 1,
    atrValid: false,
  }),
  step(state, input, i, { atrPeriod, factor }, outputs, commit) {
    const p = input.offset + i;
    const close = input.close[p] as number;
    const tr = trueRange(input, i, state.trClose);
    const atr = stepSeededAverage(
      state.atr,
      tr,
      atrPeriod,
      rmaAlpha(atrPeriod),
      commit
    );
    const hl2 = ((input.high[p] as number) + (input.low[p] as number)) / 2;
    const middle = ((input.open[p] as number) + close) / 2;
    const upOut = outputs[SUPERTREND_UP] as Float64Array;
    const downOut = outputs[SUPERTREND_DOWN] as Float64Array;
    const midOut = outputs[SUPERTREND_MIDDLE] as Float64Array;
    const valid = atr - atr === 0 && hl2 - hl2 === 0 && close - close === 0;
    let upper = 0;
    let lower = 0;
    let direction = state.direction;
    if (valid) {
      upper = hl2 + factor * atr;
      lower = hl2 - factor * atr;
      const prevClose = state.close;
      if (state.atrValid) {
        if (!(lower > state.lower || prevClose < state.lower)) {
          lower = state.lower;
        }
        if (!(upper < state.upper || prevClose > state.upper)) {
          upper = state.upper;
        }
        direction =
          state.direction > 0
            ? close > upper
              ? -1
              : 1
            : close < lower
              ? 1
              : -1;
      } else {
        direction = 1;
      }
      upOut[i] = direction < 0 ? lower : NaN;
      downOut[i] = direction > 0 ? upper : NaN;
      midOut[i] = middle;
    } else {
      upOut[i] = NaN;
      downOut[i] = NaN;
      midOut[i] = NaN;
    }
    if (commit) {
      if (tr - tr === 0 && close - close === 0) {
        state.trClose = close;
      }
      state.upper = upper;
      state.lower = lower;
      state.close = close;
      state.direction = direction;
      state.atrValid = valid;
    }
  },
};

const meta: IndicatorMeta = {
  type: 'supertrend',
  name: 'Supertrend',
  shortName: 'Supertrend',
  placement: 'overlay',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [
    { key: 'up', name: 'Up Trend' },
    { key: 'down', name: 'Down Trend' },
    { key: 'middle', name: 'Body Middle' },
  ],
  series: [
    {
      kind: 'line',
      name: 'Up Trend',
      output: SUPERTREND_UP,
      defaultColor: SUPERTREND_UP_COLOR,
    },
    {
      kind: 'line',
      name: 'Down Trend',
      output: SUPERTREND_DOWN,
      defaultColor: SUPERTREND_DOWN_COLOR,
    },
    {
      kind: 'band',
      name: 'Up Fill',
      upper: SUPERTREND_MIDDLE,
      lower: SUPERTREND_UP,
      defaultColor: SUPERTREND_UP_COLOR,
      edges: false,
    },
    {
      kind: 'band',
      name: 'Down Fill',
      upper: SUPERTREND_MIDDLE,
      lower: SUPERTREND_DOWN,
      defaultColor: SUPERTREND_DOWN_COLOR,
      edges: false,
    },
  ],
};

export const supertrendModule: IndicatorModule<SupertrendConfig> = {
  meta,
  indicator: createStepIndicator(supertrendKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    atrPeriod: resolveNumberParam(raw, ATR_PERIOD),
    factor: resolveNumberParam(raw, FACTOR),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
};
