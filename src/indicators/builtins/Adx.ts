import {
  formatIndicatorLabel,
  paramDefaults,
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
import { lengthParam } from './Stochastic';

/**
 * Directional Movement Index / ADX, TradingView "DMI":
 *
 * - `up = high − high[1]`, `down = low[1] − low`;
 * - `+DM = up > down && up > 0 ? up : 0`, `−DM = down > up && down > 0 ?
 *   down : 0`; `TR` = true range (undefined on the first bar, `ta.tr`);
 * - `+DI = 100 · RMA(+DM, n) / RMA(TR, n)`, `−DI` likewise (Pine
 *   `fixnan`: a zero `RMA(TR)` keeps the previous DI);
 * - `ADX = 100 · RMA(|+DI − −DI| / (+DI + −DI), m)` (a zero sum divides
 *   by 1).
 *
 * All RMAs are Wilder averages seeded with an SMA (`ta.rma`). Defaults
 * `n = 14` (DI length), `m = 14` (ADX smoothing): first DI at bar 14,
 * first ADX at bar 27. A bar with a non-finite high / low / close has no
 * value and is skipped. Pane indicator, auto scale. O(1) per tick.
 */
export interface AdxConfig {
  diPeriod: number;
  adxPeriod: number;
}

export interface AdxState {
  /** High / low / close of the last committed finite bar. */
  prevHigh: number;
  prevLow: number;
  prevClose: number;
  tr: SeededAverageState;
  plusDm: SeededAverageState;
  minusDm: SeededAverageState;
  adx: SeededAverageState;
  /** Last finite +DI / −DI (`fixnan`). */
  plusDi: number;
  minusDi: number;
}

/** Output column order. */
export const ADX_PLUS_DI = 0;
export const ADX_MINUS_DI = 1;
export const ADX_LINE = 2;

const DI_PERIOD = lengthParam('diPeriod', 'DI Length', 14);
const ADX_PERIOD = lengthParam('adxPeriod', 'ADX Smoothing', 14);
const PARAMS = [ADX_PERIOD, DI_PERIOD];

export const adxKernel: StepKernel<AdxConfig, AdxState> = {
  type: 'adx',
  outputs: 3,
  init: () => ({
    prevHigh: NaN,
    prevLow: NaN,
    prevClose: NaN,
    tr: createSeededAverage(),
    plusDm: createSeededAverage(),
    minusDm: createSeededAverage(),
    adx: createSeededAverage(),
    plusDi: NaN,
    minusDi: NaN,
  }),
  step(state, input, i, { diPeriod, adxPeriod }, outputs, commit) {
    const p = input.offset + i;
    const high = input.high[p] as number;
    const low = input.low[p] as number;
    const close = input.close[p] as number;
    const plusOut = outputs[ADX_PLUS_DI] as Float64Array;
    const minusOut = outputs[ADX_MINUS_DI] as Float64Array;
    const adxOut = outputs[ADX_LINE] as Float64Array;
    plusOut[i] = NaN;
    minusOut[i] = NaN;
    adxOut[i] = NaN;
    const range = high - low;
    if (!(range - range === 0) || !(close - close === 0)) {
      return;
    }
    const pc = state.prevClose;
    if (pc - pc === 0) {
      const up = high - state.prevHigh;
      const down = state.prevLow - low;
      const tr = Math.max(range, Math.abs(high - pc), Math.abs(low - pc));
      const alpha = rmaAlpha(diPeriod);
      const trur = stepSeededAverage(state.tr, tr, diPeriod, alpha, commit);
      const plusDm = up > down && up > 0 ? up : 0;
      const minusDm = down > up && down > 0 ? down : 0;
      const plusAvg = stepSeededAverage(
        state.plusDm,
        plusDm,
        diPeriod,
        alpha,
        commit
      );
      const minusAvg = stepSeededAverage(
        state.minusDm,
        minusDm,
        diPeriod,
        alpha,
        commit
      );
      const plus = trur !== 0 ? (100 * plusAvg) / trur : state.plusDi;
      const minus = trur !== 0 ? (100 * minusAvg) / trur : state.minusDi;
      plusOut[i] = plus;
      minusOut[i] = minus;
      if (plus - plus === 0 && minus - minus === 0) {
        const sum = plus + minus;
        const dx = Math.abs(plus - minus) / (sum === 0 ? 1 : sum);
        adxOut[i] =
          100 *
          stepSeededAverage(
            state.adx,
            dx,
            adxPeriod,
            rmaAlpha(adxPeriod),
            commit
          );
        if (commit) {
          state.plusDi = plus;
          state.minusDi = minus;
        }
      }
    }
    if (commit) {
      state.prevHigh = high;
      state.prevLow = low;
      state.prevClose = close;
    }
  },
};

const meta: IndicatorMeta = {
  type: 'adx',
  name: 'Directional Movement Index',
  shortName: 'DMI',
  placement: 'pane',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [
    { key: 'plusDi', name: '+DI' },
    { key: 'minusDi', name: '−DI' },
    { key: 'adx', name: 'ADX' },
  ],
  series: [
    { kind: 'line', name: 'ADX', output: ADX_LINE, defaultColor: '#F50057' },
    { kind: 'line', name: '+DI', output: ADX_PLUS_DI, defaultColor: '#2962FF' },
    {
      kind: 'line',
      name: '−DI',
      output: ADX_MINUS_DI,
      defaultColor: '#FF6D00',
    },
  ],
  scale: { kind: 'auto' },
  valueFormat: { decimals: 2 },
};

export const adxModule: IndicatorModule<AdxConfig> = {
  meta,
  indicator: createStepIndicator(adxKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    diPeriod: resolveNumberParam(raw, DI_PERIOD),
    adxPeriod: resolveNumberParam(raw, ADX_PERIOD),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
};
