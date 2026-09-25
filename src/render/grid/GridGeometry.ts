import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import { rightEdgeIndex, type TimeScaleState } from '../../viewport/TimeScale';
import { lineWidthPx, sanitizePixelRatio } from '../PixelSnap';
import { niceBarStep, nicePriceStep } from './NiceStep';

/**
 * Basic grid geometry (Phase 3.4): horizontal lines at nice price steps,
 * vertical lines at nice whole-bar steps. Lines are emitted as thin filled
 * rects snapped to device pixels. Pure, worklet-compatible, allocation-free.
 *
 * Pluggable: P4 passes its own tick sources so the grid follows the axis
 * ticks (spec §19.3) without touching this module.
 */

export interface GridSink {
  /** `value` = price (horizontal) or logical bar index (vertical). */
  line(
    horizontal: boolean,
    x: number,
    y: number,
    w: number,
    h: number,
    value: number
  ): void;
}

export interface GridOptions {
  /** Target distance between horizontal lines, dp. */
  priceSpacing: number;
  /** Target distance between vertical lines, dp. */
  timeSpacing: number;
  /** Line width, dp (rounded to ≥ 1 device pixel). */
  lineWidth: number;
  pixelRatio: number;
  /** Hard cap per direction (guards absurd steps). */
  maxLines: number;
}

/** Price step for `[min, max]` over `heightPx`; non-positive/NaN = none. */
export type PriceStepFn = (
  min: number,
  max: number,
  heightPx: number,
  spacingPx: number
) => number;
/** Whole-bar step for `barSpacing`; non-positive/NaN = none. */
export type BarStepFn = (barSpacing: number, spacingPx: number) => number;

export const DEFAULT_GRID_OPTIONS: Readonly<GridOptions> = Object.freeze({
  priceSpacing: 60,
  timeSpacing: 90,
  lineWidth: 1,
  pixelRatio: 1,
  maxLines: 200,
});

/**
 * Streams grid lines for the plot `[0, time.width] × [price.top,
 * price.top + price.height]` into `sink`. Returns the number of lines.
 */
export function buildGridGeometry(
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  options: GridOptions,
  sink: GridSink,
  priceStep: PriceStepFn = nicePriceStep,
  barStep: BarStepFn = niceBarStep
): number {
  'worklet';
  const pr = sanitizePixelRatio(options.pixelRatio);
  const widthPx = lineWidthPx(options.lineWidth, pr);
  const half = widthPx / 2;
  const w = widthPx / pr;
  const maxLines = options.maxLines > 0 ? options.maxLines : 0;
  const plotWidth = time.width;
  const top = price.top;
  const height = price.height;
  if (!(plotWidth > 0 && plotWidth < Infinity) || !Number.isFinite(top)) {
    return 0;
  }
  let lines = 0;

  // Horizontal lines.
  const k = height / (price.max - price.min);
  const pStep = priceStep(price.min, price.max, height, options.priceSpacing);
  if (height > 0 && k > 0 && k < Infinity && pStep > 0 && pStep < Infinity) {
    const first = Math.ceil(price.min / pStep);
    for (let n = 0; n < maxLines; n++) {
      const value = (first + n) * pStep;
      if (!(value <= price.max)) {
        break;
      }
      const y = Math.round((top + (price.max - value) * k) * pr - half) / pr;
      sink.line(true, 0, y, plotWidth, w, value);
      lines++;
    }
  }

  // Vertical lines.
  const spacing = time.barSpacing;
  const bStep = barStep(spacing, options.timeSpacing);
  const right = rightEdgeIndex(time);
  if (
    height > 0 &&
    spacing > 0 &&
    spacing < Infinity &&
    bStep >= 1 &&
    bStep < Infinity &&
    Number.isFinite(right)
  ) {
    const left = right - plotWidth / spacing;
    const first = Math.ceil(left / bStep);
    for (let n = 0; n < maxLines; n++) {
      const index = (first + n) * bStep;
      if (!(index <= right)) {
        break;
      }
      const x = plotWidth - (right - index) * spacing;
      sink.line(false, Math.round(x * pr - half) / pr, top, w, height, index);
      lines++;
    }
  }
  return lines;
}
