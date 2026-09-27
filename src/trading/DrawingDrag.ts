import type { CandleColumns } from '../data/CandleBuffer';
import { snapToTickSize } from '../axes/SymbolPrecision';
import { snapIndexToTime, timeToIndex } from './TimeAnchor';
import { HIT_BODY } from './HitTest';

/*
 * Drag math of drawings in data space. Anchor times snap to whole bar
 * slots (bars or future slots), prices to the tick size, so a moved
 * drawing lands on the same bars at any zoom. Pure worklets; results go
 * into a caller-provided array (flattened `[time, price, …]`).
 */

/**
 * Moves `start` anchors by `dIndex` bars and `dPrice` (body drag) or puts
 * anchor `part` at `(index, price)` (anchor drag). Returns `false` for
 * non-finite input / results or no data (`out` is then not usable).
 *
 * - body: `dIndex` is rounded, so anchors stay on slots;
 * - anchor: `index` / `price` are the finger's data coordinates.
 */
export function dragAnchors(
  series: CandleColumns,
  barMs: number,
  start: readonly number[],
  part: number,
  a: number,
  b: number,
  tickSize: number,
  out: number[]
): boolean {
  'worklet';
  if (series.length <= 0 || !Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  for (let i = 0; i < start.length; i++) {
    out[i] = start[i] as number;
  }
  out.length = start.length;
  if (part === HIT_BODY) {
    const shift = Math.round(a);
    for (let i = 0; i + 1 < start.length; i += 2) {
      const index = timeToIndex(series, start[i] as number, barMs);
      const time = snapIndexToTime(series, index + shift, barMs);
      const price = snapToTickSize((start[i + 1] as number) + b, tickSize);
      if (!Number.isFinite(time) || !Number.isFinite(price)) {
        return false;
      }
      out[i] = time;
      out[i + 1] = price;
    }
    return true;
  }
  const k = part * 2;
  if (part < 0 || k + 1 >= start.length) {
    return false;
  }
  const time = snapIndexToTime(series, a, barMs);
  const price = snapToTickSize(b, tickSize);
  if (!Number.isFinite(time) || !Number.isFinite(price)) {
    return false;
  }
  out[k] = time;
  out[k + 1] = price;
  return true;
}

/** Price of a dragged line: start price + delta, snapped to the tick. */
export function dragLinePrice(
  startPrice: number,
  dPrice: number,
  tickSize: number
): number {
  'worklet';
  return snapToTickSize(startPrice + dPrice, tickSize);
}
