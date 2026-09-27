import type {
  SkCanvas,
  SkColor,
  SkFont,
  SkPaint,
  SkPathEffect,
} from '@shopify/react-native-skia';
import { clampSpan } from '../../axes/LabelCollision';
import { measureText, type GlyphWidthTable } from '../../axes/TextMetrics';
import type { CandleColumns } from '../../data/CandleBuffer';
import {
  clipSegment,
  crispY,
  fibPrice,
  projectAnchors,
  timeToX,
  type Segment,
} from '../../trading/DrawingGeometry';
import { FIB_LEVELS } from '../../trading/DrawingModel';
import type { SceneDrawing } from '../../trading/OverlayScene';
import type { OverlayLineStyle } from '../../trading/TradingTypes';
import { priceToY, type PriceScaleSnapshot } from '../../viewport/PriceScale';
import type { TimeScaleState } from '../../viewport/TimeScale';
import { centeredBaseline, type TextBoxMetrics } from '../RenderModel';

/*
 * Drawing routines of the trading overlay picture (UI thread). Every
 * routine records into one `SkCanvas` with three reused paints whose
 * color / width / dash are set per item (a picture copies paint state per
 * draw call), so the whole overlay is one node regardless of item count.
 */

/** Everything a routine needs for one frame. */
export interface TradingFrame {
  canvas: SkCanvas;
  series: CandleColumns;
  time: TimeScaleState;
  price: PriceScaleSnapshot;
  barMs: number;
  width: number;
  height: number;
  pixelRatio: number;
  colors: readonly SkColor[];
  stroke: SkPaint;
  fill: SkPaint;
  text: SkPaint;
  dashed: SkPathEffect;
  dotted: SkPathEffect;
  font: SkFont;
  glyphs: GlyphWidthTable;
  metrics: TextBoxMetrics;
  lineHeight: number;
  fillOpacity: number;
  selection: SkColor;
  labelText: SkColor;
  /** Scratch for projected anchors / clipped segments. */
  points: number[];
  segment: Segment;
}

/** Horizontal padding inside label boxes, dp. */
export const LABEL_PADDING_X = 4;
/** Vertical padding inside label boxes, dp. */
export const LABEL_PADDING_Y = 2;
/** Left inset of line label boxes, dp. */
export const LINE_LABEL_INSET = 4;
/** Radius of drawing anchor handles, dp. */
export const HANDLE_RADIUS = 4;

/** Height of a one-line label box. */
export function labelBoxHeight(f: TradingFrame): number {
  'worklet';
  return f.lineHeight + 2 * LABEL_PADDING_Y;
}

export function setStroke(
  f: TradingFrame,
  color: SkColor | undefined,
  width: number,
  style: OverlayLineStyle
): void {
  'worklet';
  if (color !== undefined) {
    f.stroke.setColor(color);
  }
  f.stroke.setAlphaf(1);
  f.stroke.setStrokeWidth(width > 0 && width < Infinity ? width : 1);
  f.stroke.setPathEffect(
    style === 'dashed' ? f.dashed : style === 'dotted' ? f.dotted : null
  );
}

export function setFill(
  f: TradingFrame,
  color: SkColor | undefined,
  alpha: number
): void {
  'worklet';
  if (color !== undefined) {
    f.fill.setColor(color);
  }
  f.fill.setAlphaf(alpha);
}

/**
 * Filled box with `text` whose left edge is `x` and vertical center `cy`
 * (clamped into the plot). Returns the box width (`0` for empty text).
 */
export function drawLabelBox(
  f: TradingFrame,
  text: string,
  x: number,
  cy: number,
  color: SkColor | undefined
): number {
  'worklet';
  if (text === '' || !Number.isFinite(x) || !Number.isFinite(cy)) {
    return 0;
  }
  const w = measureText(f.glyphs, text) + 2 * LABEL_PADDING_X;
  const h = labelBoxHeight(f);
  const top = clampSpan(cy, h, 0, f.height);
  setFill(f, color, 1);
  f.canvas.drawRRect(
    { rect: { x, y: top, width: w, height: h }, rx: 2, ry: 2 },
    f.fill
  );
  f.text.setColor(f.labelText);
  f.canvas.drawText(
    text,
    x + LABEL_PADDING_X,
    centeredBaseline(top + h / 2, f.metrics),
    f.text,
    f.font
  );
  return w;
}

/** Circle handles at the projected points `[x0, y0, x1, y1 …]`. */
export function drawHandles(
  f: TradingFrame,
  points: ArrayLike<number>,
  count: number
): void {
  'worklet';
  for (let i = 0; i < count; i++) {
    const x = points[i * 2] as number;
    const y = points[i * 2 + 1] as number;
    const rect = {
      x: x - HANDLE_RADIUS,
      y: y - HANDLE_RADIUS,
      width: 2 * HANDLE_RADIUS,
      height: 2 * HANDLE_RADIUS,
    };
    const rrect = { rect, rx: HANDLE_RADIUS, ry: HANDLE_RADIUS };
    setFill(f, f.labelText, 1);
    f.canvas.drawRRect(rrect, f.fill);
    setStroke(f, f.selection, 1.5, 'solid');
    f.canvas.drawRRect(rrect, f.stroke);
  }
}

function drawSegment(
  f: TradingFrame,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  'worklet';
  if (clipSegment(x0, y0, x1, y1, 0, 0, f.width, f.height, f.segment)) {
    const s = f.segment;
    f.canvas.drawLine(s.x0, s.y0, s.x1, s.y1, f.stroke);
  }
}

function drawFib(f: TradingFrame, d: SceneDrawing, anchors: number[]): void {
  'worklet';
  const p = f.points;
  const left = Math.min(p[0] as number, p[2] as number);
  const right = Math.max(p[0] as number, p[2] as number);
  const first = anchors[1] as number;
  const second = anchors[3] as number;
  setStroke(f, f.colors[d.color], d.width, 'dashed');
  drawSegment(
    f,
    p[0] as number,
    p[1] as number,
    p[2] as number,
    p[3] as number
  );
  setStroke(f, f.colors[d.color], d.width, d.style);
  const color = f.colors[d.color];
  if (color !== undefined) {
    f.text.setColor(color);
  }
  for (let i = 0; i < FIB_LEVELS.length; i++) {
    const level = FIB_LEVELS[i] as number;
    const y = priceToY(f.price, fibPrice(first, second, level));
    if (Number.isFinite(y) && y >= 0 && y <= f.height) {
      const cy = crispY(y, f.pixelRatio);
      drawSegment(f, left, cy, right, cy);
      f.canvas.drawText(
        String(level),
        Math.max(0, left) + 2,
        cy - 2,
        f.text,
        f.font
      );
    }
  }
}

/** One drawing (anchors may be a drag override); handles when selected. */
export function drawDrawing(
  f: TradingFrame,
  d: SceneDrawing,
  anchors: number[],
  selected: boolean
): void {
  'worklet';
  const p = f.points;
  if (!projectAnchors(f.series, f.time, f.price, f.barMs, anchors, p)) {
    return;
  }
  const count = anchors.length / 2;
  const x0 = p[0] as number;
  const y0 = crispY(p[1] as number, f.pixelRatio);
  setStroke(f, f.colors[d.color], d.width, d.style);
  switch (d.type) {
    case 'trendLine':
      drawSegment(f, x0, p[1] as number, p[2] as number, p[3] as number);
      break;
    case 'horizontalLine':
      drawSegment(f, 0, y0, f.width, y0);
      break;
    case 'horizontalRay':
      drawSegment(f, x0, y0, f.width, y0);
      break;
    case 'rectangle': {
      const x = Math.min(x0, p[2] as number);
      const y = Math.min(p[1] as number, p[3] as number);
      const rect = {
        x,
        y,
        width: Math.abs((p[2] as number) - x0),
        height: Math.abs((p[3] as number) - (p[1] as number)),
      };
      setFill(f, f.colors[d.color], f.fillOpacity);
      f.canvas.drawRect(rect, f.fill);
      f.canvas.drawRect(rect, f.stroke);
      break;
    }
    case 'fibRetracement':
      drawFib(f, d, anchors);
      break;
  }
  if (selected) {
    drawHandles(f, p, count);
  }
}

/** Vertical line at `t` with an optional label box at the top. */
export function drawVerticalLine(
  f: TradingFrame,
  t: number,
  color: number,
  style: OverlayLineStyle,
  label: string
): void {
  'worklet';
  const x = timeToX(f.series, f.time, t, f.barMs);
  if (!(x >= 0 && x <= f.width)) {
    return;
  }
  const cx = crispY(x, f.pixelRatio);
  setStroke(f, f.colors[color], 1, style);
  f.canvas.drawLine(cx, 0, cx, f.height, f.stroke);
  drawLabelBox(f, label, cx + 2, labelBoxHeight(f) / 2 + 2, f.colors[color]);
}

/** Text note: a dot at `(t, price)` and a label box right of it. */
export function drawNote(
  f: TradingFrame,
  t: number,
  price: number,
  text: string,
  color: number
): void {
  'worklet';
  const x = timeToX(f.series, f.time, t, f.barMs);
  const y = priceToY(f.price, price);
  if (!(x >= -200 && x <= f.width) || !(y >= 0 && y <= f.height)) {
    return;
  }
  setFill(f, f.colors[color], 1);
  f.canvas.drawRRect(
    { rect: { x: x - 2.5, y: y - 2.5, width: 5, height: 5 }, rx: 2.5, ry: 2.5 },
    f.fill
  );
  drawLabelBox(f, text, x + 5, y - labelBoxHeight(f) / 2 - 2, f.colors[color]);
}
