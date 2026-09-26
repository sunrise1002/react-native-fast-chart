import type { CandleColumns } from '../../data/CandleBuffer';
import {
  applyPriceFormatter,
  type PriceFormatter,
} from '../../axes/Formatters';
import {
  formatPercent,
  formatSignedPrice,
  formatVolume,
} from '../../axes/PriceFormat';
import { measureText, type GlyphWidthTable } from '../../axes/TextMetrics';
import type { TextSink } from '../RenderModel';

/**
 * OHLC legend layout (Phase 6.5): `O … H … L … C … +Δ (+Δ%) V …` for one
 * bar, top-left of the price pane. Captions use the label style, values
 * the bar's direction color; the change is `close − open` of the bar
 * (Binance legend semantics). Groups wrap onto a new line instead of
 * overflowing `maxWidth`. Pure, worklet-compatible.
 */

export const OHLC_STYLE_CAPTION = 0;
export const OHLC_STYLE_UP = 1;
export const OHLC_STYLE_DOWN = 2;

export interface OhlcHeaderLayout {
  /** Top-left of the first text line's box and the line height, dp. */
  x: number;
  y: number;
  lineHeight: number;
  /** Baseline offset inside a line box (`centeredBaseline` of the box). */
  baselineOffset: number;
  /** Right limit for wrapping, dp. */
  maxWidth: number;
  /** Gap caption → value and between groups, dp. */
  captionGap: number;
  groupGap: number;
  glyphs: GlyphWidthTable;
  decimals: number;
  thousandsSeparator: string;
  /** Show the `V` (volume) group. */
  showVolume: boolean;
  /** Decimals of unscaled volumes (`NaN` / omitted = automatic). */
  volumeDecimals?: number;
  /** Custom O / H / L / C formatter (worklet; see `PriceFormatter`). */
  priceFormatter?: PriceFormatter;
}

interface Cursor {
  x: number;
  line: number;
}

function emitGroup(
  caption: string,
  value: string,
  valueStyle: number,
  layout: OhlcHeaderLayout,
  cursor: Cursor,
  sink: TextSink
): void {
  'worklet';
  if (value === '') {
    return;
  }
  const captionWidth = caption === '' ? 0 : measureText(layout.glyphs, caption);
  const gap = caption === '' ? 0 : layout.captionGap;
  const width = captionWidth + gap + measureText(layout.glyphs, value);
  if (cursor.x > layout.x && cursor.x + width > layout.maxWidth) {
    cursor.line++;
    cursor.x = layout.x;
  }
  const baseline =
    layout.y + cursor.line * layout.lineHeight + layout.baselineOffset;
  if (caption !== '') {
    sink.text(caption, cursor.x, baseline, OHLC_STYLE_CAPTION);
  }
  sink.text(value, cursor.x + captionWidth + gap, baseline, valueStyle);
  cursor.x += width + layout.groupGap;
}

/**
 * Emits the legend for bar `index` of `series`. Returns the number of text
 * lines used (0 when the index is out of range).
 */
export function layoutOhlcHeader(
  series: CandleColumns,
  index: number,
  layout: OhlcHeaderLayout,
  sink: TextSink
): number {
  'worklet';
  if (!(index >= 0 && index < series.length) || index % 1 !== 0) {
    return 0;
  }
  const at = series.offset + index;
  const open = series.open[at] as number;
  const close = series.close[at] as number;
  const style = close < open ? OHLC_STYLE_DOWN : OHLC_STYLE_UP;
  const { decimals, thousandsSeparator: sep, priceFormatter: fmt } = layout;
  const cursor: Cursor = { x: layout.x, line: 0 };
  emitGroup(
    'O',
    applyPriceFormatter(fmt, open, decimals, sep),
    style,
    layout,
    cursor,
    sink
  );
  emitGroup(
    'H',
    applyPriceFormatter(fmt, series.high[at] as number, decimals, sep),
    style,
    layout,
    cursor,
    sink
  );
  emitGroup(
    'L',
    applyPriceFormatter(fmt, series.low[at] as number, decimals, sep),
    style,
    layout,
    cursor,
    sink
  );
  emitGroup(
    'C',
    applyPriceFormatter(fmt, close, decimals, sep),
    style,
    layout,
    cursor,
    sink
  );
  const change = close - open;
  const percent = open !== 0 ? (change / open) * 100 : NaN;
  const changeText = formatSignedPrice(change, decimals, sep);
  const percentText = formatPercent(percent);
  emitGroup(
    '',
    percentText === '' ? changeText : changeText + ' (' + percentText + ')',
    style,
    layout,
    cursor,
    sink
  );
  if (layout.showVolume) {
    emitGroup(
      'V',
      formatVolume(series.volume[at] as number, layout.volumeDecimals),
      style,
      layout,
      cursor,
      sink
    );
  }
  return cursor.line + 1;
}
