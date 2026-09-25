import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import { indexToX, type TimeScaleState } from '../../viewport/TimeScale';
import { lineWidthPx, sanitizePixelRatio } from '../PixelSnap';

/**
 * Grid geometry derived from the axis ticks (spec §19.3): one horizontal
 * line per price tick and one vertical line per time tick, so grid and
 * labels always agree. Lines are emitted as thin filled rects snapped to
 * device pixels. Pure, worklet-compatible, allocation-free.
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
  /** Line width, dp (rounded to ≥ 1 device pixel). */
  lineWidth: number;
  pixelRatio: number;
}

/** Price tick values (see `PriceTicks`). */
export interface GridPriceTicks {
  values: ArrayLike<number>;
  count: number;
}

/** Time tick bar indices (see `TimeTicks`). */
export interface GridTimeTicks {
  positions: ArrayLike<number>;
  count: number;
}

export const DEFAULT_GRID_OPTIONS: Readonly<GridOptions> = Object.freeze({
  lineWidth: 1,
  pixelRatio: 1,
});

/**
 * Streams grid lines for the plot `[0, time.width] × [price.top,
 * price.top + price.height]` into `sink`: ticks outside the plot or with
 * non-finite coordinates are skipped. Returns the number of lines.
 */
export function buildGridGeometry(
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  priceTicks: GridPriceTicks,
  timeTicks: GridTimeTicks,
  options: GridOptions,
  sink: GridSink
): number {
  'worklet';
  const pr = sanitizePixelRatio(options.pixelRatio);
  const widthPx = lineWidthPx(options.lineWidth, pr);
  const half = widthPx / 2;
  const w = widthPx / pr;
  const plotWidth = time.width;
  const { top, height } = price;
  if (
    !(plotWidth > 0 && plotWidth < Infinity) ||
    !(height > 0 && height < Infinity) ||
    !Number.isFinite(top)
  ) {
    return 0;
  }
  let lines = 0;

  const k = height / (price.max - price.min);
  if (k > 0 && k < Infinity) {
    for (let i = 0; i < priceTicks.count; i++) {
      const value = priceTicks.values[i] as number;
      const y = top + (price.max - value) * k;
      if (!(y >= top && y <= top + height)) {
        continue;
      }
      sink.line(true, 0, Math.round(y * pr - half) / pr, plotWidth, w, value);
      lines++;
    }
  }

  for (let i = 0; i < timeTicks.count; i++) {
    const index = timeTicks.positions[i] as number;
    const x = indexToX(time, index);
    if (!(x >= 0 && x <= plotWidth)) {
      continue;
    }
    sink.line(false, Math.round(x * pr - half) / pr, top, w, height, index);
    lines++;
  }
  return lines;
}
