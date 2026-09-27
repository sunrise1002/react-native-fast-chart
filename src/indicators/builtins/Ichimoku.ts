import {
  formatIndicatorLabel,
  paramDefaults,
  resolveNumberParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import {
  createRollingExtreme,
  stepExtreme,
  type RollingExtremeState,
} from './RollingExtremes';
import { lengthParam } from './Stochastic';

/**
 * Ichimoku Cloud, TradingView "Ichimoku Cloud". With
 * `mid(n) = (highest(high, n) + lowest(low, n)) / 2`:
 *
 * - Conversion (Tenkan-sen) = `mid(conversionPeriod)`, default 9;
 * - Base (Kijun-sen) = `mid(basePeriod)`, default 26;
 * - Lagging span (Chikou) = `close`, drawn `displacement − 1` bars back;
 * - Leading span A (Senkou A) = `(conversion + base) / 2`, drawn
 *   `displacement − 1` bars ahead (default displacement 26);
 * - Leading span B (Senkou B) = `mid(spanBPeriod)`, default 52, drawn
 *   ahead like span A.
 *
 * Values are stored at the bar they are computed from; the display shift
 * is the module's `outputOffsets` (TradingView plot `offset`), so the
 * leading spans reach into the empty area right of the last bar. The
 * cloud between the spans is green where A ≥ B and red otherwise.
 * Overlay. O(1) per tick (monotonic deques).
 */
export interface IchimokuConfig {
  conversionPeriod: number;
  basePeriod: number;
  spanBPeriod: number;
  displacement: number;
}

interface MidRange {
  highest: RollingExtremeState;
  lowest: RollingExtremeState;
}

export interface IchimokuState {
  conversion: MidRange;
  base: MidRange;
  spanB: MidRange;
}

/** Output column order. */
export const ICHIMOKU_CONVERSION = 0;
export const ICHIMOKU_BASE = 1;
export const ICHIMOKU_LAGGING = 2;
export const ICHIMOKU_SPAN_A = 3;
export const ICHIMOKU_SPAN_B = 4;

const CONVERSION = lengthParam('conversionPeriod', 'Conversion Line Length', 9);
const BASE = lengthParam('basePeriod', 'Base Line Length', 26);
const SPAN_B = lengthParam('spanBPeriod', 'Leading Span B Length', 52);
const DISPLACEMENT = {
  ...lengthParam('displacement', 'Lagging Span', 26),
  max: 500,
};
const PARAMS = [CONVERSION, BASE, SPAN_B, DISPLACEMENT];

function midRange(period: number): MidRange {
  return {
    highest: createRollingExtreme(period, 1),
    lowest: createRollingExtreme(period, -1),
  };
}

function stepMid(
  range: MidRange,
  i: number,
  high: number,
  low: number,
  commit: boolean
): number {
  const h = stepExtreme(range.highest, i, high, commit);
  return (h + stepExtreme(range.lowest, i, low, commit)) / 2;
}

export const ichimokuKernel: StepKernel<IchimokuConfig, IchimokuState> = {
  type: 'ichimoku',
  outputs: 5,
  init: ({ conversionPeriod, basePeriod, spanBPeriod }) => ({
    conversion: midRange(conversionPeriod),
    base: midRange(basePeriod),
    spanB: midRange(spanBPeriod),
  }),
  step(state, input, i, _config, outputs, commit) {
    const p = input.offset + i;
    const high = input.high[p] as number;
    const low = input.low[p] as number;
    const conversion = stepMid(state.conversion, i, high, low, commit);
    const base = stepMid(state.base, i, high, low, commit);
    (outputs[ICHIMOKU_CONVERSION] as Float64Array)[i] = conversion;
    (outputs[ICHIMOKU_BASE] as Float64Array)[i] = base;
    const close = input.close[p] as number;
    (outputs[ICHIMOKU_LAGGING] as Float64Array)[i] =
      close - close === 0 ? close : NaN;
    (outputs[ICHIMOKU_SPAN_A] as Float64Array)[i] = (conversion + base) / 2;
    (outputs[ICHIMOKU_SPAN_B] as Float64Array)[i] = stepMid(
      state.spanB,
      i,
      high,
      low,
      commit
    );
  },
};

/** TradingView colors. */
export const ICHIMOKU_BULL_COLOR = '#43A047';
export const ICHIMOKU_BEAR_COLOR = '#F44336';

const meta: IndicatorMeta = {
  type: 'ichimoku',
  name: 'Ichimoku Cloud',
  shortName: 'Ichimoku',
  placement: 'overlay',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [
    { key: 'conversion', name: 'Conversion Line' },
    { key: 'base', name: 'Base Line' },
    { key: 'lagging', name: 'Lagging Span' },
    { key: 'spanA', name: 'Leading Span A' },
    { key: 'spanB', name: 'Leading Span B' },
  ],
  series: [
    {
      kind: 'line',
      name: 'Conversion Line',
      output: ICHIMOKU_CONVERSION,
      defaultColor: '#2962FF',
    },
    {
      kind: 'line',
      name: 'Base Line',
      output: ICHIMOKU_BASE,
      defaultColor: '#B71C1C',
    },
    {
      kind: 'line',
      name: 'Lagging Span',
      output: ICHIMOKU_LAGGING,
      defaultColor: ICHIMOKU_BULL_COLOR,
    },
    {
      kind: 'line',
      name: 'Leading Span A',
      output: ICHIMOKU_SPAN_A,
      defaultColor: '#A5D6A7',
    },
    {
      kind: 'line',
      name: 'Leading Span B',
      output: ICHIMOKU_SPAN_B,
      defaultColor: '#EF9A9A',
    },
    {
      kind: 'band',
      name: 'Cloud',
      upper: ICHIMOKU_SPAN_A,
      lower: ICHIMOKU_SPAN_B,
      defaultColor: ICHIMOKU_BULL_COLOR,
      downColor: ICHIMOKU_BEAR_COLOR,
      edges: false,
    },
  ],
};

export const ichimokuModule: IndicatorModule<IchimokuConfig> = {
  meta,
  indicator: createStepIndicator(ichimokuKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    conversionPeriod: resolveNumberParam(raw, CONVERSION),
    basePeriod: resolveNumberParam(raw, BASE),
    spanBPeriod: resolveNumberParam(raw, SPAN_B),
    displacement: resolveNumberParam(raw, DISPLACEMENT),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
  outputOffsets: ({ displacement }) => {
    const shift = displacement - 1;
    return [0, 0, -shift, shift, shift];
  },
};
