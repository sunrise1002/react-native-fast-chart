import {
  matchFont,
  PaintStyle,
  Skia,
  type SkFont,
  type SkPaint,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import {
  createGlyphWidthTable,
  measuredCharacters,
  type GlyphWidthTable,
} from '../../axes/TextMetrics';
import type { ChartTheme, ColorValue } from '../../theme/ChartTheme';
import type { TextBoxMetrics } from '../RenderModel';

/**
 * The chart's single text font and its measurement table, created once
 * per font family / size (never per frame — spec Phase 17.4).
 */
export interface ChartFont {
  font: SkFont;
  size: number;
  glyphs: GlyphWidthTable;
  metrics: TextBoxMetrics;
  /** Height of a text line box (ascent + descent), dp. */
  lineHeight: number;
}

export function createChartFont(
  fontSize: number,
  fontFamily?: string
): ChartFont {
  const size = fontSize > 0 && fontSize < Infinity ? fontSize : 10;
  const font = matchFont(
    fontFamily ? { fontFamily, fontSize: size } : { fontSize: size }
  );
  const widths = font.getGlyphWidths(font.getGlyphIDs(measuredCharacters()));
  const raw = font.getMetrics();
  const ascent = Math.abs(raw.ascent) > 0 ? Math.abs(raw.ascent) : size;
  const descent = Math.abs(raw.descent);
  return {
    font,
    size,
    glyphs: createGlyphWidthTable(widths),
    metrics: { ascent, descent },
    lineHeight: ascent + descent,
  };
}

export function useChartFont(theme: ChartTheme): ChartFont {
  const { fontSize, fontFamily } = theme.axis;
  return useMemo(
    () => createChartFont(fontSize, fontFamily),
    [fontSize, fontFamily]
  );
}

function fillPaint(color: ColorValue): SkPaint {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(color));
  return paint;
}

function dashedPaint(
  color: ColorValue,
  width: number,
  dash: readonly number[]
): SkPaint {
  const paint = fillPaint(color);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(width > 0 && width < Infinity ? width : 1);
  if (dash.length >= 2) {
    paint.setPathEffect(Skia.PathEffect.MakeDash([...dash], 0));
  }
  return paint;
}

/** Paints of the axes / overlay pictures, rebuilt only on theme changes. */
export interface ChartPaints {
  axisText: SkPaint;
  /** Last-price badge backgrounds. */
  bullish: SkPaint;
  bearish: SkPaint;
  lastPriceLineUp: SkPaint;
  lastPriceLineDown: SkPaint;
  lastPriceText: SkPaint;
  crosshairLine: SkPaint;
  crosshairLabel: SkPaint;
  crosshairText: SkPaint;
  /** OHLC legend values (candle colors). */
  legendUp: SkPaint;
  legendDown: SkPaint;
  /** Indicator guide levels (dashed) and the guide band fill. */
  guideLine: SkPaint;
  guideBand: SkPaint;
}

export function createChartPaints(theme: ChartTheme): ChartPaints {
  const { axis, candle, crosshair, lastPrice, pane } = theme;
  return {
    axisText: fillPaint(axis.textColor),
    bullish: fillPaint(lastPrice.bullishColor),
    bearish: fillPaint(lastPrice.bearishColor),
    lastPriceLineUp: dashedPaint(lastPrice.bullishColor, 1, lastPrice.lineDash),
    lastPriceLineDown: dashedPaint(
      lastPrice.bearishColor,
      1,
      lastPrice.lineDash
    ),
    lastPriceText: fillPaint(lastPrice.labelTextColor),
    crosshairLine: dashedPaint(
      crosshair.color,
      crosshair.width,
      crosshair.dash
    ),
    crosshairLabel: fillPaint(crosshair.labelBackground),
    crosshairText: fillPaint(crosshair.labelTextColor),
    legendUp: fillPaint(candle.bullish),
    legendDown: fillPaint(candle.bearish),
    guideLine: dashedPaint(pane.guideColor, 1, pane.guideDash),
    guideBand: fillPaint(pane.guideBandColor),
  };
}

export function useChartPaints(theme: ChartTheme): ChartPaints {
  return useMemo(() => createChartPaints(theme), [theme]);
}
