import type { PriceTicks } from '../../axes/PriceTicks';
import { rangesOverlap } from '../../axes/LabelCollision';
import { priceToY, type PriceScaleSnapshot } from '../../viewport/PriceScale';
import {
  centeredBaseline,
  type TextBoxMetrics,
  type TextSink,
} from '../RenderModel';

/**
 * Price axis label layout (Phase 5.2): one label per price tick, vertically
 * centered on the tick, left-aligned in the right-hand axis gutter.
 * Labels that would leave the pane or collide with a reserved span (the
 * last-price badge) are skipped. Pure, worklet-compatible; the Skia layer
 * draws what the sink receives.
 */

export const PRICE_LABEL_STYLE = 0;

/** Vertical span `[top, bottom]` that tick labels must not overlap. */
export interface ReservedSpan {
  top: number;
  bottom: number;
}

export interface PriceAxisLayout {
  /** Left edge of the label text, dp. */
  textX: number;
  metrics: TextBoxMetrics;
  /** Gap kept between labels and a reserved span, dp. */
  gap: number;
}

/**
 * Emits the visible tick labels (`labels[i]` for `ticks.values[i]`).
 * `reserved` may be `null`; spans with a NaN edge are ignored. Returns the
 * number of labels emitted.
 */
export function layoutPriceAxisLabels(
  ticks: PriceTicks,
  labels: readonly string[],
  price: PriceScaleSnapshot,
  layout: PriceAxisLayout,
  reserved: ReservedSpan | null,
  sink: TextSink
): number {
  'worklet';
  const { metrics } = layout;
  const half = (metrics.ascent + metrics.descent) / 2;
  const paneTop = price.top;
  const paneBottom = price.top + price.height;
  let emitted = 0;
  for (let i = 0; i < ticks.count; i++) {
    const text = labels[i];
    const y = priceToY(price, ticks.values[i] as number);
    if (text === undefined || text === '' || !Number.isFinite(y)) {
      continue;
    }
    if (y - half < paneTop || y + half > paneBottom) {
      continue;
    }
    if (
      reserved !== null &&
      rangesOverlap(
        y - half,
        y + half,
        reserved.top,
        reserved.bottom,
        layout.gap
      )
    ) {
      continue;
    }
    sink.text(
      text,
      layout.textX,
      centeredBaseline(y, metrics),
      PRICE_LABEL_STYLE
    );
    emitted++;
  }
  return emitted;
}
