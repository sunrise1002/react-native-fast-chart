import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import { indexToX, type TimeScaleState } from '../../viewport/TimeScale';
import {
  firstIndex,
  lastIndex,
  valueY,
  type FillPathSink,
} from './LineGeometry';

/*
 * Two-color band ("cloud", Ichimoku Kumo) geometry. Pure and
 * worklet-compatible. The area between series `a` and `b` is split where
 * the two lines cross (at the exact screen intersection of their
 * segments), so the bullish (`a` above `b`) and bearish parts can be
 * filled with different paints — each part is one polygon per run, all
 * streamed into one path per color.
 */

/** Screen-space signed gap `y(b) − y(a)` (> 0 when `a` is above `b`). */
function gap(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  i: number,
  price: PriceScaleSnapshot
): number {
  'worklet';
  return valueY(b, i, price) - valueY(a, i, price);
}

/** Bar `i` belongs to the side `sign` (`+1`: `a ≥ b`, `−1`: `a < b`). */
function onSide(g: number, sign: number): boolean {
  'worklet';
  return sign > 0 ? g >= 0 : g < 0;
}

/** Drawable bar (finite x and both edges) on side `sign`. */
function inside(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  i: number,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  sign: number
): boolean {
  'worklet';
  const x = indexToX(time, i);
  const g = gap(a, b, i, price);
  return x - x === 0 && g - g === 0 && onSide(g, sign);
}

/** Drawable bar on the other side (a crossing neighbour). */
function across(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  i: number,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  sign: number
): boolean {
  'worklet';
  const x = indexToX(time, i);
  const g = gap(a, b, i, price);
  return x - x === 0 && g - g === 0 && !onSide(g, sign);
}

/** Line from/to the crossing between bars `i` and `i + 1`. */
function crossing(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  i: number,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  sink: FillPathSink,
  move: boolean
): void {
  'worklet';
  const g0 = gap(a, b, i, price);
  const g1 = gap(a, b, i + 1, price);
  // The sides differ, so g0 − g1 ≠ 0.
  const t = g0 / (g0 - g1);
  const x0 = indexToX(time, i);
  const y0 = valueY(a, i, price);
  const x = x0 + t * (indexToX(time, i + 1) - x0);
  const y = y0 + t * (valueY(a, i + 1, price) - y0);
  if (move) {
    sink.moveTo(x, y);
  } else {
    sink.lineTo(x, y);
  }
}

/**
 * Streams the part of the area between `a` and `b` over `[start, end]`
 * that lies on side `sign` (`+1`: where `a` is above or equal to `b`;
 * `−1`: where `a` is below `b`). Each maximal run of drawable bars on
 * that side becomes one closed polygon, extended to the crossing points
 * with its drawable neighbours. Returns the number of polygons.
 */
export function buildCloudFill(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  length: number,
  start: number,
  end: number,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  sign: number,
  sink: FillPathSink
): number {
  'worklet';
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }
  const n = Math.min(length, a.length, b.length);
  const to = lastIndex(end, n);
  let polygons = 0;
  let i = firstIndex(start);
  while (i <= to) {
    while (i <= to && !inside(a, b, i, time, price, sign)) {
      i++;
    }
    const k = i;
    while (i <= to && inside(a, b, i, time, price, sign)) {
      i++;
    }
    const m = i - 1;
    if (m < k) {
      break;
    }
    const entry = k > 0 && across(a, b, k - 1, time, price, sign);
    const exit = m + 1 < n && across(a, b, m + 1, time, price, sign);
    if (entry) {
      crossing(a, b, k - 1, time, price, sink, true);
      sink.lineTo(indexToX(time, k), valueY(a, k, price));
    } else {
      sink.moveTo(indexToX(time, k), valueY(a, k, price));
    }
    for (let j = k + 1; j <= m; j++) {
      sink.lineTo(indexToX(time, j), valueY(a, j, price));
    }
    if (exit) {
      crossing(a, b, m, time, price, sink, false);
    }
    for (let j = m; j >= k; j--) {
      sink.lineTo(indexToX(time, j), valueY(b, j, price));
    }
    sink.close();
    polygons++;
  }
  return polygons;
}
