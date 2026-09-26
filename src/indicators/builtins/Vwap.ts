import {
  createBucketAligner,
  type BucketAligner,
} from '../../data/BucketAligner';
import { parseTimeframe, type TimeframeSpec } from '../../data/Timeframe';
import type { PriceSource } from '../Indicator';
import {
  formatIndicatorLabel,
  paramDefaults,
  resolveChoiceParam,
  resolveNumberParam,
  resolveSourceParam,
  sourceParam,
  type ChoiceParam,
  type NumberParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import { readSource } from '../IndicatorSeries';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';

/**
 * Anchored VWAP, TradingView "VWAP" (`ta.vwap(source, anchor, mult)`):
 *
 * - the anchor period (session = calendar day, week from Monday, month)
 *   starts at midnight in the **chart time zone** (`IndicatorContext`,
 *   DST-aware, the same alignment as daily bars);
 * - `vwap = Σ(x·v) / Σv` over the bars of the current period, `x = hlc3`;
 * - bands `vwap ± k·σ` with the volume-weighted standard deviation
 *   `σ = √(Σ(x²·v) / Σv − vwap²)`, one pair per multiplier
 *   (`0` = band off; defaults 1 / off / off).
 *
 * Sums are kept relative to the period's first price (no catastrophic
 * cancellation in `σ` at large price levels). `NaN` until the period has
 * volume; bars with a non-finite price / volume / time are skipped.
 * Overlay. O(1) per tick.
 */
export type VwapAnchor = 'session' | 'week' | 'month';

export interface VwapConfig {
  anchor: VwapAnchor;
  source: PriceSource;
  band1: number;
  band2: number;
  band3: number;
}

export interface VwapState {
  readonly buckets: BucketAligner;
  /** Period of the last committed bar: `[start, end)`. */
  start: number;
  end: number;
  /** Reference price of the period (its first finite price). */
  shift: number;
  /** Σv, Σ(x − shift)·v, Σ(x − shift)²·v of the period. */
  volume: number;
  sum: number;
  sumSq: number;
}

/** Output column order: VWAP, then upper / lower per band. */
export const VWAP_LINE = 0;
export const VWAP_UPPER_1 = 1;
export const VWAP_LOWER_1 = 2;
export const VWAP_UPPER_2 = 3;
export const VWAP_LOWER_2 = 4;
export const VWAP_UPPER_3 = 5;
export const VWAP_LOWER_3 = 6;

const ANCHORS: readonly VwapAnchor[] = ['session', 'week', 'month'];
const ANCHOR: ChoiceParam & {
  readonly options: readonly VwapAnchor[];
  readonly default: VwapAnchor;
} = {
  key: 'anchor',
  label: 'Anchor Period',
  kind: 'choice',
  options: ANCHORS,
  default: 'session',
};
const ANCHOR_TIMEFRAMES: Record<VwapAnchor, TimeframeSpec> = {
  session: parseTimeframe('1d') as TimeframeSpec,
  week: parseTimeframe('1w') as TimeframeSpec,
  month: parseTimeframe('1M') as TimeframeSpec,
};
const SOURCE = sourceParam('hlc3');
function bandParam(n: number, value: number): NumberParam {
  return {
    key: `band${n}`,
    label: `Bands Multiplier #${n}`,
    kind: 'number',
    min: 0,
    max: 50,
    step: 0.5,
    default: value,
  };
}
const BAND_1 = bandParam(1, 1);
const BAND_2 = bandParam(2, 0);
const BAND_3 = bandParam(3, 0);
const PARAMS = [ANCHOR, SOURCE, BAND_1, BAND_2, BAND_3];

function writeBand(
  outputs: Float64Array[],
  upper: number,
  i: number,
  vwap: number,
  sigma: number,
  multiplier: number
): void {
  const on = multiplier > 0;
  (outputs[upper] as Float64Array)[i] = on ? vwap + multiplier * sigma : NaN;
  (outputs[upper + 1] as Float64Array)[i] = on
    ? vwap - multiplier * sigma
    : NaN;
}

export const vwapKernel: StepKernel<VwapConfig, VwapState> = {
  type: 'vwap',
  outputs: 7,
  init: ({ anchor }, context) => ({
    buckets: createBucketAligner(ANCHOR_TIMEFRAMES[anchor], context.timeZone),
    start: NaN,
    end: NaN,
    shift: NaN,
    volume: 0,
    sum: 0,
    sumSq: 0,
  }),
  step(state, input, i, config, outputs, commit) {
    const p = input.offset + i;
    const time = input.time[p] as number;
    const x = readSource(input, i, config.source);
    const v = input.volume[p] as number;
    if (!(time - time === 0) || !(x - x === 0) || !(v - v === 0)) {
      for (let k = 0; k < outputs.length; k++) {
        (outputs[k] as Float64Array)[i] = NaN;
      }
      return;
    }
    let { start, end, shift, volume, sum, sumSq } = state;
    if (!(time >= start && time < end)) {
      start = state.buckets.bucketOf(time);
      end = state.buckets.nextBucket(start);
      shift = x;
      volume = 0;
      sum = 0;
      sumSq = 0;
    }
    const d = x - shift;
    volume += v;
    sum += d * v;
    sumSq += d * d * v;
    const mean = sum / volume;
    const vwap = volume > 0 ? shift + mean : NaN;
    const variance = sumSq / volume - mean * mean;
    const sigma = variance > 0 ? Math.sqrt(variance) : 0;
    (outputs[VWAP_LINE] as Float64Array)[i] = vwap;
    writeBand(outputs, VWAP_UPPER_1, i, vwap, sigma, config.band1);
    writeBand(outputs, VWAP_UPPER_2, i, vwap, sigma, config.band2);
    writeBand(outputs, VWAP_UPPER_3, i, vwap, sigma, config.band3);
    if (commit) {
      state.start = start;
      state.end = end;
      state.shift = shift;
      state.volume = volume;
      state.sum = sum;
      state.sumSq = sumSq;
    }
  },
};

const meta: IndicatorMeta = {
  type: 'vwap',
  name: 'Volume Weighted Average Price',
  shortName: 'VWAP',
  placement: 'overlay',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [
    { key: 'vwap', name: 'VWAP' },
    { key: 'upper1', name: 'Upper Band #1' },
    { key: 'lower1', name: 'Lower Band #1' },
    { key: 'upper2', name: 'Upper Band #2' },
    { key: 'lower2', name: 'Lower Band #2' },
    { key: 'upper3', name: 'Upper Band #3' },
    { key: 'lower3', name: 'Lower Band #3' },
  ],
  series: [
    { kind: 'line', name: 'VWAP', output: VWAP_LINE, defaultColor: '#2962FF' },
    {
      kind: 'band',
      name: 'Band #1',
      upper: VWAP_UPPER_1,
      lower: VWAP_LOWER_1,
      defaultColor: '#4CAF50',
    },
    {
      kind: 'band',
      name: 'Band #2',
      upper: VWAP_UPPER_2,
      lower: VWAP_LOWER_2,
      defaultColor: '#808000',
    },
    {
      kind: 'band',
      name: 'Band #3',
      upper: VWAP_UPPER_3,
      lower: VWAP_LOWER_3,
      defaultColor: '#00897B',
    },
  ],
  usesContext: true,
};

export const vwapModule: IndicatorModule<VwapConfig> = {
  meta,
  indicator: createStepIndicator(vwapKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    anchor: resolveChoiceParam(raw, ANCHOR),
    source: resolveSourceParam(raw, SOURCE),
    band1: resolveNumberParam(raw, BAND_1),
    band2: resolveNumberParam(raw, BAND_2),
    band3: resolveNumberParam(raw, BAND_3),
  }),
  formatLabel: ({ anchor, source }) =>
    formatIndicatorLabel(meta.shortName, [ANCHOR, SOURCE], { anchor, source }),
};
