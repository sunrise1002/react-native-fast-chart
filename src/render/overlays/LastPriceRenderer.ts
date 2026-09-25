import type { CandleColumns } from '../../data/CandleBuffer';
import { clampSpan } from '../../axes/LabelCollision';
import { priceToY, type PriceScaleSnapshot } from '../../viewport/PriceScale';

/**
 * Last price marker layout (Phase 5.5): a dashed line at the last close
 * and a badge on the price axis, colored by the last bar's direction. When
 * the last close is outside the pane the line is hidden and the badge is
 * pinned to the top / bottom edge (TradingView behavior). The badge height
 * is supplied by the caller, so a second line (e.g. a bar countdown) can
 * be reserved without changing this module. Pure, worklet-compatible.
 */

export const LAST_PRICE_PINNED_NONE = 0;
export const LAST_PRICE_PINNED_TOP = -1;
export const LAST_PRICE_PINNED_BOTTOM = 1;

export interface LastPriceMarker {
  visible: boolean;
  price: number;
  bullish: boolean;
  /** Y of the dashed line; `NaN` when the price is off-screen. */
  lineY: number;
  /** Badge box top / height, dp. */
  badgeTop: number;
  badgeHeight: number;
  /** `LAST_PRICE_PINNED_*`. */
  pinned: number;
}

export function createLastPriceMarker(): LastPriceMarker {
  'worklet';
  return {
    visible: false,
    price: NaN,
    bullish: true,
    lineY: NaN,
    badgeTop: NaN,
    badgeHeight: 0,
    pinned: LAST_PRICE_PINNED_NONE,
  };
}

/**
 * Fills `out` for the last bar of `series`. Invisible (`visible = false`)
 * when there is no bar, the close is not finite, or the scale is
 * degenerate. Returns `out.visible`.
 */
export function computeLastPriceMarker(
  series: CandleColumns,
  price: PriceScaleSnapshot,
  badgeHeight: number,
  out: LastPriceMarker
): boolean {
  'worklet';
  out.visible = false;
  out.lineY = NaN;
  out.badgeTop = NaN;
  out.pinned = LAST_PRICE_PINNED_NONE;
  out.badgeHeight = badgeHeight > 0 && badgeHeight < Infinity ? badgeHeight : 0;
  if (series.length <= 0 || !(price.height > 0)) {
    return false;
  }
  const at = series.offset + series.length - 1;
  const close = series.close[at] as number;
  const open = series.open[at] as number;
  const y = priceToY(price, close);
  if (!Number.isFinite(y)) {
    return false;
  }
  const top = price.top;
  const bottom = price.top + price.height;
  out.price = close;
  out.bullish = !(close < open);
  out.pinned =
    y < top
      ? LAST_PRICE_PINNED_TOP
      : y > bottom
        ? LAST_PRICE_PINNED_BOTTOM
        : LAST_PRICE_PINNED_NONE;
  out.lineY = out.pinned === LAST_PRICE_PINNED_NONE ? y : NaN;
  out.badgeTop = clampSpan(y, out.badgeHeight, top, bottom);
  out.visible = true;
  return true;
}
