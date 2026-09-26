import {
  createLabelCache,
  lookupLabel,
  storeLabel,
  type LabelCache,
} from '../../axes/LabelCache';
import { formatPrice } from '../../axes/PriceFormat';
import { measureText, type GlyphWidthTable } from '../../axes/TextMetrics';
import { formatTimeTick } from '../../axes/TimeFormat';
import type { TimeTicks } from '../../axes/TimeTicks';
import { formatIndicatorValue } from '../overlays/IndicatorLegendRenderer';

/*
 * Cached axis label formatting (P8 text audit): each helper returns the
 * label text and leaves its width in `cache.lastWidth`. The caches belong
 * to one axes layer, whose glyph table and thousands separator are fixed
 * for the cache's lifetime (see `createAxisLabelCaches`).
 */

export interface AxisLabelCaches {
  price: LabelCache;
  time: LabelCache;
  pane: LabelCache;
}

export function createAxisLabelCaches(): AxisLabelCaches {
  return {
    price: createLabelCache(),
    time: createLabelCache(),
    pane: createLabelCache(),
  };
}

/** Price label with `decimals` decimals. Worklet. */
export function cachedPriceLabel(
  cache: LabelCache,
  glyphs: GlyphWidthTable,
  value: number,
  decimals: number,
  separator: string
): string {
  'worklet';
  const hit = lookupLabel(cache, value, decimals);
  if (hit !== null) {
    return hit;
  }
  const text = formatPrice(value, decimals, separator);
  return storeLabel(cache, value, decimals, text, measureText(glyphs, text));
}

/** Indicator-pane label (`compact` K/M/B or fixed decimals). Worklet. */
export function cachedPaneLabel(
  cache: LabelCache,
  glyphs: GlyphWidthTable,
  value: number,
  decimals: number,
  compact: boolean,
  separator: string
): string {
  'worklet';
  const key = compact ? -1 : decimals;
  const hit = lookupLabel(cache, value, key);
  if (hit !== null) {
    return hit;
  }
  const text = formatIndicatorValue(
    value,
    decimals,
    compact,
    decimals,
    separator
  );
  return storeLabel(cache, value, key, text, measureText(glyphs, text));
}

/** Reused label texts + widths of one axis (entries past the count are stale). */
export interface LabelBuffer {
  texts: string[];
  widths: Float64Array;
}

export function createLabelBuffer(capacity: number): LabelBuffer {
  const size = capacity > 0 && capacity < Infinity ? Math.ceil(capacity) : 0;
  return {
    texts: new Array<string>(size).fill(''),
    widths: new Float64Array(size),
  };
}

/** Fills `out[0 … ticks.count)` with the labels of `ticks`. Worklet. */
export function cachedTimeLabels(
  cache: LabelCache,
  glyphs: GlyphWidthTable,
  ticks: TimeTicks,
  withSeconds: boolean,
  out: LabelBuffer
): LabelBuffer {
  'worklet';
  for (let i = 0; i < ticks.count; i++) {
    const local = ticks.payload[i] as number;
    const weight = ticks.weights[i] as number;
    const key = weight * 2 + (withSeconds ? 1 : 0);
    const hit = lookupLabel(cache, local, key);
    if (hit !== null) {
      out.texts[i] = hit;
    } else {
      const text = formatTimeTick(local, weight, withSeconds);
      out.texts[i] = storeLabel(
        cache,
        local,
        key,
        text,
        measureText(glyphs, text)
      );
    }
    out.widths[i] = cache.lastWidth;
  }
  return out;
}
