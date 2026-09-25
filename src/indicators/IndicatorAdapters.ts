import type { CandleColumns } from '../data/CandleBuffer';
import type {
  BandPoint,
  HistogramPoint,
  HistogramPolarity,
  IndicatorResult,
  LinePoint,
  MultiLineResult,
} from './Indicator';
import { isFiniteValue } from './IndicatorSeries';

/*
 * Adapters from columnar results to the spec's point shapes (§13.3) for
 * public API consumers (tooltips, exports, tests). They allocate one
 * object per bar — never use them on per-frame / per-tick paths.
 * `time` comes from the candle columns the result was computed from.
 */

function barCount(result: IndicatorResult, candles: CandleColumns): number {
  return Math.min(result.length, candles.length);
}

function column(result: IndicatorResult, output: number): Float64Array {
  const values = result.outputs[output];
  if (!values) {
    throw new RangeError(`Indicator output ${output} does not exist`);
  }
  return values;
}

const timeAt = (candles: CandleColumns, i: number): number =>
  candles.time[candles.offset + i] as number;

/** Line points of output `output`; warm-up / invalid values are `null`. */
export function toLinePoints(
  result: IndicatorResult,
  candles: CandleColumns,
  output = 0
): LinePoint[] {
  const values = column(result, output);
  const n = barCount(result, candles);
  const points: LinePoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = values[i] as number;
    points[i] = {
      time: timeAt(candles, i),
      value: isFiniteValue(v) ? v : null,
    };
  }
  return points;
}

/** Several outputs keyed by name (`names[k]` ↔ output `k`). */
export function toMultiLine(
  result: IndicatorResult,
  candles: CandleColumns,
  names: readonly string[]
): MultiLineResult {
  const lines: Record<string, LinePoint[]> = {};
  names.forEach((name, k) => {
    lines[name] = toLinePoints(result, candles, k);
  });
  return { lines };
}

/** Bars where every band edge is finite; `middle` omitted when absent. */
export function toBandPoints(
  result: IndicatorResult,
  candles: CandleColumns,
  upper: number,
  lower: number,
  middle?: number
): BandPoint[] {
  const up = column(result, upper);
  const low = column(result, lower);
  const mid = middle === undefined ? undefined : column(result, middle);
  const n = barCount(result, candles);
  const points: BandPoint[] = [];
  for (let i = 0; i < n; i++) {
    const u = up[i] as number;
    const l = low[i] as number;
    if (!isFiniteValue(u) || !isFiniteValue(l)) {
      continue;
    }
    const point: BandPoint = { time: timeAt(candles, i), upper: u, lower: l };
    const m = mid?.[i];
    if (m !== undefined && isFiniteValue(m)) {
      point.middle = m;
    }
    points.push(point);
  }
  return points;
}

/** Polarity by sign: `> 0` positive, `< 0` negative, `0` neutral. */
export function histogramPolarity(value: number): HistogramPolarity {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
}

/** Histogram points of the bars with a finite value. */
export function toHistogramPoints(
  result: IndicatorResult,
  candles: CandleColumns,
  output = 0
): HistogramPoint[] {
  const values = column(result, output);
  const n = barCount(result, candles);
  const points: HistogramPoint[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i] as number;
    if (isFiniteValue(v)) {
      points.push({
        time: timeAt(candles, i),
        value: v,
        polarity: histogramPolarity(v),
      });
    }
  }
  return points;
}
