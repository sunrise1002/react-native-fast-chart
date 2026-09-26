import type { MinMaxPyramid } from '../../data/MinMaxPyramid';
import { priceToY, type PriceScaleSnapshot } from '../../viewport/PriceScale';
import { indexToX, type TimeScaleState } from '../../viewport/TimeScale';
import type { LinePathSink } from '../indicators/LineGeometry';
import {
  conflatedTimeScale,
  groupExtremes,
  groupLevel,
  groupSpan,
  growColumn,
  type ConflatedValues,
} from './Conflation';

/*
 * Indicator-side conflation (Phase 18.3): per-bucket min/max envelopes of
 * an indicator output (lines, band edges, histograms) and the envelope
 * polyline. Pure TypeScript, worklet-compatible.
 */

/**
 * Conflates `values[start..end]` (bar `i` at `values[i]`, `length` bars)
 * into group envelopes. The pyramid must be synced with `values` as both
 * sources. Returns the bucket count.
 */
export function conflateValues(
  values: ArrayLike<number>,
  length: number,
  pyramid: MinMaxPyramid,
  start: number,
  end: number,
  time: TimeScaleState,
  group: number,
  out: ConflatedValues,
  scratch: { min: number; max: number }
): number {
  'worklet';
  const n = length < values.length ? length : values.length;
  const count = groupSpan(start, end, n, group, out);
  if (count > out.min.length) {
    out.min = growColumn(out.min, count);
    out.max = growColumn(out.max, count);
    out.first = growColumn(out.first, count);
    out.last = growColumn(out.last, count);
    out.peak = growColumn(out.peak, count);
  }
  const level = groupLevel(group);
  for (let b = 0; b < count; b++) {
    const k = out.firstGroup + b;
    const firstBar = k * group;
    const lastBar = Math.min(firstBar + group, n) - 1;
    groupExtremes(pyramid, values, values, 0, level, k, scratch);
    const lo = scratch.min;
    const hi = scratch.max;
    out.min[b] = lo;
    out.max[b] = hi;
    out.first[b] = values[firstBar] as number;
    out.last[b] = values[lastBar] as number;
    out.peak[b] =
      lo < Infinity && hi > -Infinity
        ? Math.abs(hi) >= Math.abs(lo)
          ? hi
          : lo
        : NaN;
  }
  out.length = count;
  conflatedTimeScale(time, group, out.firstGroup, count, out.scale);
  return count;
}

/**
 * Streams the envelope polyline of conflated values: per bucket a
 * vertical run from the group's min to its max, ordered by the group's
 * trend (first → last) so consecutive buckets connect naturally. Empty
 * buckets break the line. At most 2 points per bucket; returns the
 * number of points emitted.
 */
export function buildEnvelopeLine(
  env: ConflatedValues,
  price: PriceScaleSnapshot,
  sink: LinePathSink
): number {
  'worklet';
  let penDown = false;
  let points = 0;
  for (let b = 0; b < env.length; b++) {
    const lo = env.min[b] as number;
    const hi = env.max[b] as number;
    const x = indexToX(env.scale, b);
    const yLo = priceToY(price, lo);
    const yHi = priceToY(price, hi);
    if (x - x !== 0 || yLo - yLo !== 0 || yHi - yHi !== 0) {
      penDown = false;
      continue;
    }
    // Falling group (last < first): max first, then min.
    const falling = (env.last[b] as number) < (env.first[b] as number);
    const y1 = falling ? yHi : yLo;
    const y2 = falling ? yLo : yHi;
    if (penDown) {
      sink.lineTo(x, y1);
    } else {
      sink.moveTo(x, y1);
      penDown = true;
    }
    points++;
    if (y2 !== y1) {
      sink.lineTo(x, y2);
      points++;
    }
  }
  return points;
}
