import type { DrawingType } from './DrawingModel';

/*
 * Hit testing of overlays in screen space (dp). Pure, allocation-free
 * worklets used by the overlay gestures on the UI thread.
 */

/** Nothing hit. */
export const HIT_NONE = -2;
/** The drawing's body (move all anchors). */
export const HIT_BODY = -1;
/* Anchor `k` hit → returns `k` (0, 1, …). */

/** Distance from `(px, py)` to the segment `(x0, y0) → (x1, y1)`. */
export function distanceToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  'worklet';
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (x0 + t * dx);
  const ey = py - (y0 + t * dy);
  const d = Math.sqrt(ex * ex + ey * ey);
  return Number.isFinite(d) ? d : Infinity;
}

function near(a: number, b: number, slop: number): boolean {
  'worklet';
  return Math.abs(a - b) <= slop;
}

function within(v: number, a: number, b: number, slop: number): boolean {
  'worklet';
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return v >= lo - slop && v <= hi + slop;
}

/**
 * Hit test of one drawing given its projected points `[x0, y0, x1, y1]`
 * (one-anchor tools use `x0, y0`). Anchors are tested first when
 * `withAnchors` (the selected drawing shows handles); returns the anchor
 * index, `HIT_BODY` or `HIT_NONE`. `plotWidth` bounds full-width lines.
 */
export function hitTestDrawing(
  type: DrawingType,
  points: ArrayLike<number>,
  plotWidth: number,
  px: number,
  py: number,
  slop: number,
  withAnchors: boolean
): number {
  'worklet';
  if (!Number.isFinite(px) || !Number.isFinite(py) || !(slop >= 0)) {
    return HIT_NONE;
  }
  const x0 = points[0] as number;
  const y0 = points[1] as number;
  const two =
    type === 'trendLine' || type === 'rectangle' || type === 'fibRetracement';
  const x1 = two ? (points[2] as number) : x0;
  const y1 = two ? (points[3] as number) : y0;
  if (withAnchors) {
    if (near(px, x0, slop) && near(py, y0, slop)) {
      return 0;
    }
    if (two && near(px, x1, slop) && near(py, y1, slop)) {
      return 1;
    }
  }
  switch (type) {
    case 'trendLine':
      return distanceToSegment(px, py, x0, y0, x1, y1) <= slop
        ? HIT_BODY
        : HIT_NONE;
    case 'horizontalLine':
      return near(py, y0, slop) && px >= -slop && px <= plotWidth + slop
        ? HIT_BODY
        : HIT_NONE;
    case 'horizontalRay':
      return near(py, y0, slop) && px >= x0 - slop && px <= plotWidth + slop
        ? HIT_BODY
        : HIT_NONE;
    default:
      // Rectangle / Fibonacci: anywhere inside the anchors' box.
      return within(px, x0, x1, slop) && within(py, y0, y1, slop)
        ? HIT_BODY
        : HIT_NONE;
  }
}

/**
 * Hit test of a draggable price line's handles: its label box
 * `[boxLeft, boxRight]` and its axis badge `[plotWidth, axisRight]`,
 * within `slop` of the line's `y`. A line without a label box
 * (`boxRight <= boxLeft`) is grabbed on the badge or the last
 * `handleWidth` dp of the plot.
 */
export function hitTestLineHandle(
  lineY: number,
  boxLeft: number,
  boxRight: number,
  plotWidth: number,
  axisRight: number,
  handleWidth: number,
  px: number,
  py: number,
  slop: number
): boolean {
  'worklet';
  if (!Number.isFinite(lineY) || !near(py, lineY, slop)) {
    return false;
  }
  if (boxRight > boxLeft && px >= boxLeft - slop && px <= boxRight + slop) {
    return true;
  }
  return px >= plotWidth - handleWidth && px <= axisRight;
}
