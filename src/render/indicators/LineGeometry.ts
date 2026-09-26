import { priceToY, type PriceScaleSnapshot } from '../../viewport/PriceScale';
import { clampCoordinate } from '../../utils/Sanitize';
import { indexToX, type TimeScaleState } from '../../viewport/TimeScale';

/*
 * Indicator line / band geometry (Phase 8.5–8.6, spec §17.3). Pure and
 * worklet-compatible: points of the visible slice are streamed into a
 * sink (a Skia path builder in the renderer, a recorder in tests), so a
 * series becomes exactly one path. `NaN` / ±∞ values or coordinates break
 * the line (warm-up gaps, spec §33.8).
 */

export interface LinePathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
}

export interface FillPathSink extends LinePathSink {
  close(): void;
}

export { MAX_ABS_COORDINATE } from '../../utils/Sanitize';

function firstIndex(start: number): number {
  'worklet';
  return start > 0 ? Math.ceil(start) : 0;
}

function lastIndex(end: number, length: number): number {
  'worklet';
  return end < length - 1 ? Math.floor(end) : length - 1;
}

/** Screen y of `values[i]`, `NaN` when it cannot be drawn. */
function valueY(
  values: ArrayLike<number>,
  i: number,
  price: PriceScaleSnapshot
): number {
  'worklet';
  const y = priceToY(price, values[i] as number);
  return clampCoordinate(y);
}

/**
 * Streams the polyline of `values[start..end]` (inclusive, clamped to
 * `[0, length)`). Returns the number of points emitted.
 */
export function buildLineGeometry(
  values: ArrayLike<number>,
  length: number,
  start: number,
  end: number,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  sink: LinePathSink
): number {
  'worklet';
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }
  const to = lastIndex(end, Math.min(length, values.length));
  let penDown = false;
  let points = 0;
  for (let i = firstIndex(start); i <= to; i++) {
    const x = indexToX(time, i);
    const y = valueY(values, i, price);
    if (!(x - x === 0) || !(y - y === 0)) {
      penDown = false;
      continue;
    }
    if (penDown) {
      sink.lineTo(x, y);
    } else {
      sink.moveTo(x, y);
      penDown = true;
    }
    points++;
  }
  return points;
}

function bandDrawable(
  upper: ArrayLike<number>,
  lower: ArrayLike<number>,
  i: number,
  time: TimeScaleState,
  price: PriceScaleSnapshot
): boolean {
  'worklet';
  const x = indexToX(time, i);
  return (
    x - x === 0 &&
    !Number.isNaN(valueY(upper, i, price)) &&
    !Number.isNaN(valueY(lower, i, price))
  );
}

/**
 * Streams the area between `upper` and `lower` over `[start, end]` as one
 * closed polygon per run of bars where both edges are drawable (upper edge
 * left → right, lower edge back, close). Returns the number of polygons.
 */
export function buildBandFill(
  upper: ArrayLike<number>,
  lower: ArrayLike<number>,
  length: number,
  start: number,
  end: number,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  sink: FillPathSink
): number {
  'worklet';
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }
  const to = lastIndex(end, Math.min(length, upper.length, lower.length));
  let polygons = 0;
  let i = firstIndex(start);
  while (i <= to) {
    // Next run [a, b] of drawable bars.
    while (i <= to && !bandDrawable(upper, lower, i, time, price)) {
      i++;
    }
    const a = i;
    while (i <= to && bandDrawable(upper, lower, i, time, price)) {
      i++;
    }
    const b = i - 1;
    if (b < a) {
      break;
    }
    sink.moveTo(indexToX(time, a), valueY(upper, a, price));
    for (let j = a + 1; j <= b; j++) {
      sink.lineTo(indexToX(time, j), valueY(upper, j, price));
    }
    for (let j = b; j >= a; j--) {
      sink.lineTo(indexToX(time, j), valueY(lower, j, price));
    }
    sink.close();
    polygons++;
  }
  return polygons;
}
