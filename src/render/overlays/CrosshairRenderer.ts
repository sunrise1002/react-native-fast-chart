import type { CandleColumns } from '../../data/CandleBuffer';
import { yToPrice, type PriceScaleSnapshot } from '../../viewport/PriceScale';
import {
  indexToX,
  xToNearestIndex,
  type TimeScaleState,
} from '../../viewport/TimeScale';

/**
 * Crosshair math (Phase 6.2–6.4): nearest-bar lookup for a touch X, the
 * snapped vertical line X and the price under the touch Y (label boxes
 * are pinned with `clampSpan`). Pure, worklet-compatible, allocation-free.
 */

/**
 * Bar under `x`, clamped to the data (`[0, barCount - 1]`) so the
 * crosshair always inspects a real bar; `-1` without data or for a
 * degenerate scale / non-finite `x`. O(1): bars are evenly spaced.
 */
export function nearestBarIndex(time: TimeScaleState, x: number): number {
  'worklet';
  if (time.barCount <= 0 || !Number.isFinite(x)) {
    return -1;
  }
  const index = xToNearestIndex(time, x);
  if (Number.isNaN(index)) {
    return -1;
  }
  const last = Math.floor(time.barCount) - 1;
  return index <= 0 ? 0 : index > last ? last : index;
}

export interface CrosshairFrame {
  visible: boolean;
  /** Bar index, snapped line X and clamped line Y (dp, plot space). */
  index: number;
  x: number;
  y: number;
  /** Price under `y`. */
  price: number;
  /** Bar open time (Unix ms, UTC). */
  time: number;
}

export function createCrosshairFrame(): CrosshairFrame {
  'worklet';
  return { visible: false, index: -1, x: NaN, y: NaN, price: NaN, time: NaN };
}

/**
 * Resolves the crosshair for bar `index` and finger `fingerY`: the
 * vertical line snaps to the bar center (device-pixel snapped), the
 * horizontal line follows the finger (clamped into the pane). Hidden when
 * the bar is missing or off-screen. Returns `out.visible`.
 */
export function computeCrosshair(
  series: CandleColumns,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  index: number,
  fingerY: number,
  pixelRatio: number,
  out: CrosshairFrame
): boolean {
  'worklet';
  out.visible = false;
  out.index = -1;
  if (
    !(index >= 0 && index < series.length) ||
    index % 1 !== 0 ||
    !Number.isFinite(fingerY) ||
    !(price.height > 0)
  ) {
    return false;
  }
  const x = indexToX(time, index);
  if (!(x >= 0 && x <= time.width)) {
    return false;
  }
  const pr = pixelRatio > 0 && pixelRatio < Infinity ? pixelRatio : 1;
  const bottom = price.top + price.height;
  const y =
    fingerY < price.top ? price.top : fingerY > bottom ? bottom : fingerY;
  out.index = index;
  // Center of a device pixel: a 1 px line stays crisp.
  out.x = (Math.floor(x * pr) + 0.5) / pr;
  const snappedY = (Math.floor(y * pr) + 0.5) / pr;
  out.y = snappedY > bottom ? bottom - 0.5 / pr : snappedY;
  out.price = yToPrice(price, y);
  out.time = series.time[series.offset + index] as number;
  out.visible = true;
  return true;
}
