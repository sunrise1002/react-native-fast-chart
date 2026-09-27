import type { MarkerPosition, MarkerShape } from './TradingTypes';

/*
 * Marker glyphs (fills, event markers) as path contours. Shapes are
 * streamed into a sink (a Skia path builder satisfies it), so every marker
 * of one color goes into a single batched path. Pure worklets.
 */

/** Subset of a path builder the marker geometry needs. */
export interface MarkerPathSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  close(): unknown;
  addCircle(x: number, y: number, r: number): unknown;
}

/** Default marker size (box edge), dp. */
export const MARKER_SIZE = 10;
/** Gap between a bar's high / low and an `above` / `below` marker, dp. */
export const MARKER_GAP = 4;

/**
 * Center Y of a marker of `size`: above the bar high, below the bar low,
 * or at the price (arrows put their tip on the price).
 */
export function markerCenterY(
  position: MarkerPosition,
  shape: MarkerShape,
  highY: number,
  lowY: number,
  priceY: number,
  size: number
): number {
  'worklet';
  const half = size / 2;
  if (position === 'above') {
    return highY - MARKER_GAP - half;
  }
  if (position === 'below') {
    return lowY + MARKER_GAP + half;
  }
  if (shape === 'arrowUp') {
    return priceY + half;
  }
  if (shape === 'arrowDown') {
    return priceY - half;
  }
  return priceY;
}

/**
 * Adds one marker contour centered on `(cx, cy)` within a `size` box.
 * Arrows point up / down with the tip on the box edge. Returns `false`
 * (nothing added) for non-finite coordinates or a non-positive size.
 */
export function addMarkerShape(
  sink: MarkerPathSink,
  shape: MarkerShape,
  cx: number,
  cy: number,
  size: number
): boolean {
  'worklet';
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !(size > 0)) {
    return false;
  }
  const h = size / 2;
  switch (shape) {
    case 'circle':
      sink.addCircle(cx, cy, h);
      return true;
    case 'square':
      sink.moveTo(cx - h, cy - h);
      sink.lineTo(cx + h, cy - h);
      sink.lineTo(cx + h, cy + h);
      sink.lineTo(cx - h, cy + h);
      sink.close();
      return true;
    case 'diamond':
      sink.moveTo(cx, cy - h);
      sink.lineTo(cx + h, cy);
      sink.lineTo(cx, cy + h);
      sink.lineTo(cx - h, cy);
      sink.close();
      return true;
    default: {
      // Arrow: triangular head (60 % of the box) + stem (30 % wide).
      const dir = shape === 'arrowDown' ? -1 : 1;
      const tip = cy - dir * h;
      const neck = tip + dir * size * 0.6;
      const tail = cy + dir * h;
      const stem = size * 0.15;
      sink.moveTo(cx, tip);
      sink.lineTo(cx + h, neck);
      sink.lineTo(cx + stem, neck);
      sink.lineTo(cx + stem, tail);
      sink.lineTo(cx - stem, tail);
      sink.lineTo(cx - stem, neck);
      sink.lineTo(cx - h, neck);
      sink.close();
      return true;
    }
  }
}
