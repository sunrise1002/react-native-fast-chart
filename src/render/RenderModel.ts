import type { Rect } from '../core/ChartTypes';
import type { PriceScaleSnapshot } from '../viewport/PriceScale';

/**
 * Renderer-agnostic, screen-space render model (spec §16).
 *
 * Everything here is plain numbers in dp (device-independent pixels,
 * already snapped to the device pixel grid where noted); no Skia types.
 * Geometry producers either fill these structures (tests, picture caches,
 * alternative renderers) or stream the same primitives into a sink
 * (`CandleGeometrySink`, `GridGeometrySink`) that writes straight into
 * renderer objects such as Skia path builders — the per-frame path.
 */

/** Axis-aligned rectangle list stored flat: `[x, y, width, height]` × count. */
export interface RectList {
  /** Flat `x, y, w, h` quadruples; capacity may exceed `count * 4`. */
  data: Float32Array;
  count: number;
}

/** How the candle batch was drawn for the current zoom level. */
export type CandleDrawMode = 'candles' | 'wicks';

/** The four candle batches (spec §17.2): one path each when rendered. */
export interface CandleGeometryBatch {
  mode: CandleDrawMode;
  bullBodies: RectList;
  bearBodies: RectList;
  /** Wicks are thin filled rects (crisp at any pixel ratio). */
  bullWicks: RectList;
  bearWicks: RectList;
  /** Bars skipped because a coordinate was non-finite. */
  skipped: number;
}

export type GridLineOrientation = 'horizontal' | 'vertical';

export interface GridLineGeometry {
  orientation: GridLineOrientation;
  /** Snapped line rect (lines are drawn as thin filled rects). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Price (horizontal) or logical bar index (vertical) of the line. */
  value: number;
}

/**
 * Receives positioned text (axis labels, badges, legend). `style` is a
 * small integer the renderer maps to a paint (see the `*_STYLE_*`
 * constants of each layout module).
 */
export interface TextSink {
  text(text: string, x: number, baseline: number, style: number): void;
}

/** Vertical font metrics, dp, both positive (Skia's ascent is negative). */
export interface TextBoxMetrics {
  /** Distance from the baseline up to the top of the glyphs. */
  ascent: number;
  /** Distance from the baseline down to the bottom of the glyphs. */
  descent: number;
}

/** Baseline that vertically centers a line of text on `centerY`. */
export function centeredBaseline(
  centerY: number,
  metrics: TextBoxMetrics
): number {
  'worklet';
  return centerY + (metrics.ascent - metrics.descent) / 2;
}

export interface AxisLabelGeometry {
  text: string;
  x: number;
  y: number;
  /** Price (price axis) or bar index (time axis). */
  value: number;
}

export interface LineGeometry {
  id: string;
  /** Flat `x, y` pairs; `NaN` pairs break the line (warm-up gaps). */
  points: Float32Array;
  count: number;
}

export interface HistogramGeometry {
  id: string;
  positive: RectList;
  negative: RectList;
}

export interface BandGeometry {
  id: string;
  upper: LineGeometry;
  lower: LineGeometry;
}

export interface PaneRenderModel {
  id: string;
  /** Plot rect of the pane (excluding axis gutters). */
  frame: Rect;
  yScale: PriceScaleSnapshot;
  candles?: CandleGeometryBatch;
  lines: LineGeometry[];
  histograms: HistogramGeometry[];
  bands: BandGeometry[];
  gridLines: GridLineGeometry[];
  labels: AxisLabelGeometry[];
}

export interface TimeAxisRenderModel {
  frame: Rect;
  gridLines: GridLineGeometry[];
  labels: AxisLabelGeometry[];
}

export interface CrosshairRenderModel {
  x: number;
  y: number;
  index: number;
  price: number;
}

export interface ChartRenderModel {
  panes: PaneRenderModel[];
  timeAxis: TimeAxisRenderModel;
  crosshair?: CrosshairRenderModel;
}

/** Allocates an empty rect list with room for `capacity` rects. */
export function createRectList(capacity: number): RectList {
  const safe = Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
  return { data: new Float32Array(Math.ceil(safe) * 4), count: 0 };
}

/** Appends a rect, doubling the storage when full. */
export function pushRect(
  list: RectList,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const at = list.count * 4;
  if (at + 4 > list.data.length) {
    const next = new Float32Array(Math.max(16, list.data.length * 2));
    next.set(list.data);
    list.data = next;
  }
  list.data[at] = x;
  list.data[at + 1] = y;
  list.data[at + 2] = width;
  list.data[at + 3] = height;
  list.count++;
}
