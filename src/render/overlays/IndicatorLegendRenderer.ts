import { formatPrice } from '../../axes/PriceFormat';
import { measureText, type GlyphWidthTable } from '../../axes/TextMetrics';
import type { UiCandleSeries } from '../../data/UiCandleSeries';
import {
  isSeriesAligned,
  type UiIndicatorSet,
} from '../../indicators/UiIndicatorSet';
import type { TextSink } from '../RenderModel';

/**
 * Indicator rows of the legend (TradingView style): one line per overlay,
 * `EMA 20  65,432.10`, values at the inspected bar (crosshair, otherwise
 * the last bar) in the series colors. Missing values (warm-up, results
 * not aligned with the candles yet) are omitted. Pure, worklet.
 */

/** Caption style; value styles are `INDICATOR_LEGEND_STYLE_VALUE + k`. */
export const INDICATOR_LEGEND_STYLE_CAPTION = 0;
export const INDICATOR_LEGEND_STYLE_VALUE = 1;

export interface IndicatorLegendItem {
  id: string;
  label: string;
  /** Output column + text style of each value. */
  values: readonly { output: number; style: number }[];
}

export interface IndicatorLegendLayout {
  x: number;
  /** Top of the first row box. */
  y: number;
  lineHeight: number;
  baselineOffset: number;
  /** Right limit; values wrap onto a new line beyond it. */
  maxWidth: number;
  gap: number;
  glyphs: GlyphWidthTable;
  decimals: number;
  thousandsSeparator: string;
}

/** Emits the rows; returns the number of text lines used. */
export function layoutIndicatorLegend(
  items: readonly IndicatorLegendItem[],
  set: UiIndicatorSet,
  candles: UiCandleSeries,
  index: number,
  layout: IndicatorLegendLayout,
  sink: TextSink
): number {
  'worklet';
  const { x: left, gap, glyphs } = layout;
  const top = layout.y + layout.baselineOffset;
  let line = 0;
  for (let r = 0; r < items.length; r++) {
    const item = items[r] as IndicatorLegendItem;
    sink.text(
      item.label,
      left,
      top + line * layout.lineHeight,
      INDICATOR_LEGEND_STYLE_CAPTION
    );
    let x = left + measureText(glyphs, item.label) + gap;
    const series = set.series[item.id];
    const valid =
      series !== undefined &&
      isSeriesAligned(series, candles) &&
      index >= 0 &&
      index < series.length &&
      index % 1 === 0;
    for (let k = 0; valid && k < item.values.length; k++) {
      const spec = item.values[k] as { output: number; style: number };
      const column = series.outputs[spec.output];
      const text =
        column === undefined
          ? ''
          : formatPrice(
              column[index] as number,
              layout.decimals,
              layout.thousandsSeparator
            );
      if (text === '') {
        continue;
      }
      const width = measureText(glyphs, text);
      if (x > left && x + width > layout.maxWidth) {
        line++;
        x = left;
      }
      sink.text(text, x, top + line * layout.lineHeight, spec.style);
      x += width + gap;
    }
    line++;
  }
  return line;
}
