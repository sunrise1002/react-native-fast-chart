import type { PriceRange } from '../core/ChartTypes';
import type { UiCandleSeries } from '../data/UiCandleSeries';
import type { IndicatorScaleSpec } from '../indicators/IndicatorRegistry';
import {
  extendRangeWithOutputs,
  type UiIndicatorSet,
  type UiOutputRef,
} from '../indicators/UiIndicatorSet';
import { normalizePriceRange } from '../viewport/PriceScale';

/*
 * Independent Y scales of indicator panes (spec §11.2, Phase 9.4): the
 * displayed range of a pane from the visible values of its series and the
 * pane's strategy. Pure, worklet-compatible, allocation-free apart from the
 * degenerate-range fallback.
 */

/** Padding of `'auto'` / `'zeroCentered'` ranges, share of the span. */
export const PANE_SCALE_PADDING = 0.1;
/** Padding of `'fixed'` ranges (keeps 0 / 100 labels inside the pane). */
export const FIXED_SCALE_PADDING = 0.05;
/** Headroom above the tallest volume bar, share of the max. */
export const VOLUME_SCALE_HEADROOM = 0.1;

/**
 * The pane-range strategy of `computePaneRange` applied to the raw
 * visible `values` min / max (`+∞` / `−∞` when empty; modified in place).
 * Lets callers collect the values their own way (e.g. from a min/max
 * pyramid at extreme zoom-out).
 */
export function paneRangeFromValues(
  scale: IndicatorScaleSpec,
  values: PriceRange,
  out: PriceRange
): boolean {
  'worklet';
  out.min = NaN;
  out.max = NaN;
  if (scale.kind === 'fixed') {
    if (!(scale.max > scale.min) || !(scale.max - scale.min < Infinity)) {
      return false;
    }
    const pad = (scale.max - scale.min) * FIXED_SCALE_PADDING;
    out.min = scale.min - pad;
    out.max = scale.max + pad;
    return true;
  }
  const range = values;
  if (!(range.max >= range.min)) {
    return false;
  }
  if (scale.kind === 'volume') {
    const top = range.max > 0 ? range.max : 1;
    out.min = 0;
    out.max = top * (1 + VOLUME_SCALE_HEADROOM);
    return true;
  }
  if (scale.kind === 'zeroCentered') {
    range.min = range.min < 0 ? range.min : 0;
    range.max = range.max > 0 ? range.max : 0;
  }
  const normalized = normalizePriceRange(range.min, range.max);
  const pad = (normalized.max - normalized.min) * PANE_SCALE_PADDING;
  out.min = normalized.min - pad;
  out.max = normalized.max + pad;
  return true;
}

/**
 * Writes the displayed range of a pane into `out` for bars `[start, end]`:
 *
 * - `'fixed'`: `[min, max]` of the spec (RSI 0–100) with a small padding;
 * - `'volume'`: `0 … max visible × (1 + headroom)`;
 * - `'zeroCentered'`: visible min / max, always including 0 (MACD), padded;
 * - `'auto'` / `'price'`: visible min / max, padded.
 *
 * Values come from the aligned, finite outputs of `refs`. Returns `false`
 * (and leaves `out` NaN) when nothing is drawable — except `'fixed'`,
 * which is always valid for a valid spec.
 */
export function computePaneRange(
  scale: IndicatorScaleSpec,
  set: UiIndicatorSet,
  candles: UiCandleSeries,
  refs: readonly UiOutputRef[],
  start: number,
  end: number,
  out: PriceRange
): boolean {
  'worklet';
  const range = { min: Infinity, max: -Infinity };
  if (scale.kind !== 'fixed') {
    extendRangeWithOutputs(set, candles, refs, start, end, range);
  }
  return paneRangeFromValues(scale, range, out);
}
