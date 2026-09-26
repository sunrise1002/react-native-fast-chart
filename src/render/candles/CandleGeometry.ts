import { clampCoordinate } from '../../utils/Sanitize';
import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import { rightEdgeIndex, type TimeScaleState } from '../../viewport/TimeScale';
import { lineWidthPx, sanitizePixelRatio } from '../PixelSnap';

/**
 * Candle geometry builder (spec §17.2, Phase 3.1): visible bars → body
 * rects + wick rects, classified bullish (`close >= open`) / bearish.
 *
 * Pure TypeScript, worklet-compatible and allocation-free: primitives are
 * streamed into a `CandleGeometrySink`, which either appends to a Skia path
 * builder (UI thread, every frame) or collects a `CandleGeometryBatch`
 * (tests, caches). All coordinates are dp, snapped to device pixels.
 */

/** Minimal read view of OHLC columns; bar `i` is at `column[offset + i]`. */
export interface CandleSeriesView {
  readonly open: ArrayLike<number>;
  readonly high: ArrayLike<number>;
  readonly low: ArrayLike<number>;
  readonly close: ArrayLike<number>;
  readonly offset: number;
  readonly length: number;
}

/** Receives rects in dp (`x, y` = top-left). Wicks are thin filled rects. */
export interface CandleGeometrySink {
  body(bullish: boolean, x: number, y: number, w: number, h: number): void;
  wick(bullish: boolean, x: number, y: number, w: number, h: number): void;
}

/** Per-zoom-level candle sizes in whole device pixels. */
export interface CandleMetrics {
  /** `true` when bodies are too narrow to differ from wicks. */
  wickOnly: boolean;
  bodyWidthPx: number;
  wickWidthPx: number;
  pixelRatio: number;
}

/**
 * A body must be at least this many device px wider than the wick to be
 * drawn (1 px of body on each side); narrower bars are drawn wick-only
 * (colored high–low lines, the precursor of P8 conflation).
 */
export const MIN_BODY_OVER_WICK_PX = 2;

export function createCandleMetrics(): CandleMetrics {
  'worklet';
  return { wickOnly: false, bodyWidthPx: 1, wickWidthPx: 1, pixelRatio: 1 };
}

/**
 * Computes body/wick widths for a bar spacing. Body width is
 * `barSpacing * bodyRatio` (ratio clamped to `[0, 1]`) floored to device
 * pixels, min 1, and adjusted to the wick's parity so the wick is exactly
 * centered. Invalid inputs degrade to 1 px wicks / wick-only mode.
 */
export function computeCandleMetrics(
  barSpacing: number,
  bodyRatio: number,
  wickWidthDp: number,
  pixelRatio: number,
  out: CandleMetrics
): CandleMetrics {
  'worklet';
  const pr = sanitizePixelRatio(pixelRatio);
  const wickPx = lineWidthPx(wickWidthDp, pr);
  const ratio = bodyRatio > 0 ? (bodyRatio < 1 ? bodyRatio : 1) : 0;
  const raw = Math.floor(barSpacing * ratio * pr);
  let bodyPx = raw >= 1 && raw < Infinity ? raw : 1;
  const wickOnly = bodyPx < wickPx + MIN_BODY_OVER_WICK_PX;
  if (!wickOnly && (bodyPx - wickPx) % 2 !== 0) {
    bodyPx -= 1;
  }
  out.wickOnly = wickOnly;
  out.bodyWidthPx = bodyPx;
  out.wickWidthPx = wickPx;
  out.pixelRatio = pr;
  return out;
}

/**
 * Streams the geometry of bars `[start, end]` (inclusive, clamped to the
 * series) into `sink`. Bars with a non-finite price are skipped (spec
 * §33.8). Doji / flat bars get a 1 device-pixel body and wick. Returns
 * the number of bars emitted; a degenerate time or price scale emits none.
 */
export function buildCandleGeometry(
  series: CandleSeriesView,
  start: number,
  end: number,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  metrics: CandleMetrics,
  sink: CandleGeometrySink
): number {
  'worklet';
  const from = start > 0 ? Math.ceil(start) : 0;
  const to = end < series.length - 1 ? Math.floor(end) : series.length - 1;
  const spacing = time.barSpacing;
  const k = price.height / (price.max - price.min);
  const right = rightEdgeIndex(time);
  if (
    !(from <= to) ||
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    !(spacing > 0 && spacing < Infinity) ||
    !(k > 0 && k < Infinity) ||
    !Number.isFinite(right) ||
    !Number.isFinite(time.width) ||
    !Number.isFinite(price.top)
  ) {
    return 0;
  }
  const pr = metrics.pixelRatio;
  const bodyPx = metrics.bodyWidthPx;
  const wickPx = metrics.wickWidthPx;
  const wickOnly = metrics.wickOnly;
  const halfBody = bodyPx / 2;
  const halfWick = wickPx / 2;
  const wickInset = (bodyPx - wickPx) / 2;
  const { open, high, low, close, offset } = series;
  const top = price.top;
  const max = price.max;
  let emitted = 0;

  for (let i = from; i <= to; i++) {
    const p = offset + i;
    const o = open[p] as number;
    const h = high[p] as number;
    const l = low[p] as number;
    const c = close[p] as number;
    const cxPx = (time.width - (right - i) * spacing) * pr;
    // Clamped far outside the plot (float32-safe); `NaN` when non-finite.
    const yh = clampCoordinate((top + (max - h) * k) * pr);
    const yl = clampCoordinate((top + (max - l) * k) * pr);
    // `x - x === 0` is false for NaN and ±Infinity.
    if (
      cxPx - cxPx !== 0 ||
      yh - yh !== 0 ||
      yl - yl !== 0 ||
      o - o !== 0 ||
      c - c !== 0
    ) {
      continue;
    }
    const bullish = c >= o;
    const wickTop = Math.round(yh < yl ? yh : yl);
    let wickBottom = Math.round(yh < yl ? yl : yh);
    if (wickBottom - wickTop < 1) {
      wickBottom = wickTop + 1;
    }
    let wickLeft: number;
    if (wickOnly) {
      wickLeft = Math.round(cxPx - halfWick);
    } else {
      const yo = clampCoordinate((top + (max - o) * k) * pr);
      const yc = clampCoordinate((top + (max - c) * k) * pr);
      if (yo - yo !== 0 || yc - yc !== 0) {
        continue;
      }
      const bodyLeft = Math.round(cxPx - halfBody);
      const bodyTop = Math.round(yo < yc ? yo : yc);
      let bodyBottom = Math.round(yo < yc ? yc : yo);
      if (bodyBottom - bodyTop < 1) {
        bodyBottom = bodyTop + 1;
      }
      sink.body(
        bullish,
        bodyLeft / pr,
        bodyTop / pr,
        bodyPx / pr,
        (bodyBottom - bodyTop) / pr
      );
      wickLeft = bodyLeft + wickInset;
    }
    sink.wick(
      bullish,
      wickLeft / pr,
      wickTop / pr,
      wickPx / pr,
      (wickBottom - wickTop) / pr
    );
    emitted++;
  }
  return emitted;
}
