import type { CandleColumns } from '../data/CandleBuffer';
import { clampCoordinate } from '../utils/Sanitize';
import { priceToY, type PriceScaleSnapshot } from '../viewport/PriceScale';
import { indexToX, type TimeScaleState } from '../viewport/TimeScale';
import { timeToIndex } from './TimeAnchor';

/*
 * Screen geometry of data-space overlays (drawings, time-anchored
 * markers). Allocation-free worklets writing into caller buffers; every
 * output coordinate is finite and clamped (spec §33.8).
 */

/** Mutable segment used as clip output. */
export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function createSegment(): Segment {
  'worklet';
  return { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/** X of `time` for the current frame (`NaN` without data). */
export function timeToX(
  series: CandleColumns,
  time: TimeScaleState,
  t: number,
  barMs: number
): number {
  'worklet';
  const index = timeToIndex(series, t, barMs);
  return Number.isFinite(index) ? clampCoordinate(indexToX(time, index)) : NaN;
}

/**
 * Projects flattened `[time, price, …]` anchors into `out` as
 * `[x, y, …]`. Returns `false` when any point is not finite (no data,
 * degenerate scale): the drawing is skipped.
 */
export function projectAnchors(
  series: CandleColumns,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  barMs: number,
  anchors: readonly number[],
  out: Float64Array | number[]
): boolean {
  'worklet';
  for (let i = 0; i + 1 < anchors.length; i += 2) {
    const x = timeToX(series, time, anchors[i] as number, barMs);
    const y = priceToY(price, anchors[i + 1] as number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    out[i] = x;
    out[i + 1] = clampCoordinate(y);
  }
  return true;
}

/**
 * Liang–Barsky clip of segment `(x0, y0) → (x1, y1)` to the rect
 * `[left, right] × [top, bottom]`. Fills `out`, returns `false` when the
 * segment misses the rect (or has non-finite ends).
 */
export function clipSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  out: Segment
): boolean {
  'worklet';
  if (
    !Number.isFinite(x0) ||
    !Number.isFinite(y0) ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1)
  ) {
    return false;
  }
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const p0 = -dx;
  const p1 = dx;
  const p2 = -dy;
  const p3 = dy;
  const q0 = x0 - left;
  const q1 = right - x0;
  const q2 = y0 - top;
  const q3 = bottom - y0;
  for (let k = 0; k < 4; k++) {
    const p = k === 0 ? p0 : k === 1 ? p1 : k === 2 ? p2 : p3;
    const q = k === 0 ? q0 : k === 1 ? q1 : k === 2 ? q2 : q3;
    if (p === 0) {
      if (q < 0) {
        return false;
      }
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) {
          return false;
        }
        if (r > t0) {
          t0 = r;
        }
      } else {
        if (r < t0) {
          return false;
        }
        if (r < t1) {
          t1 = r;
        }
      }
    }
  }
  out.x0 = x0 + t0 * dx;
  out.y0 = y0 + t0 * dy;
  out.x1 = x0 + t1 * dx;
  out.y1 = y0 + t1 * dy;
  return true;
}

/**
 * Price of Fibonacci `level` between the first anchor (`level 1`) and the
 * second anchor (`level 0`), TradingView's retracement convention.
 */
export function fibPrice(first: number, second: number, level: number): number {
  'worklet';
  return second + (first - second) * level;
}

/** Device-pixel center of `y` (crisp 1 px horizontal lines). */
export function crispY(y: number, pixelRatio: number): number {
  'worklet';
  const pr = pixelRatio > 0 && pixelRatio < Infinity ? pixelRatio : 1;
  return (Math.floor(y * pr) + 0.5) / pr;
}
