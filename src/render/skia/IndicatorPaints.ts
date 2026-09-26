import {
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkPaint,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import type { ColorValue } from '../../theme/ChartTheme';
import type { OverlayRenderSpec } from '../indicators/OverlayRenderSpec';
import {
  INDICATOR_LEGEND_STYLE_VALUE,
  type IndicatorLegendItem,
} from '../overlays/IndicatorLegendRenderer';

/** Paint-resolved overlay spec, captured by the indicator / legend mappers. */
export interface IndicatorDrawItem {
  id: string;
  fills: { upper: number; lower: number; paint: SkPaint }[];
  strokes: { output: number; paint: SkPaint }[];
}

export interface IndicatorDrawList {
  items: IndicatorDrawItem[];
  legend: IndicatorLegendItem[];
  /** Legend value paints; style `INDICATOR_LEGEND_STYLE_VALUE + k` → `[k]`. */
  legendPaints: SkPaint[];
}

export function colorPaint(color: ColorValue, opacity: number): SkPaint {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(color));
  paint.setAlphaf(paint.getAlphaf() * opacity);
  return paint;
}

export function strokePaint(color: ColorValue, width: number, opacity: number) {
  const paint = colorPaint(color, opacity);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(width);
  paint.setStrokeJoin(StrokeJoin.Round);
  paint.setStrokeCap(StrokeCap.Round);
  return paint;
}

/** Legend number format applied to every item of a draw list. */
export interface LegendFormat {
  /** Fixed decimals, `-1` for the chart's price decimals. */
  decimals: number;
  compact: boolean;
}

/** Creates the paints once per spec change (JS thread, never per frame). */
export function createIndicatorDrawList(
  specs: readonly OverlayRenderSpec[],
  format?: LegendFormat
): IndicatorDrawList {
  const legendPaints: SkPaint[] = [];
  const items: IndicatorDrawItem[] = [];
  const legend: IndicatorLegendItem[] = [];
  for (const spec of specs) {
    items.push({
      id: spec.id,
      fills: spec.fills.map((f) => ({
        upper: f.upper,
        lower: f.lower,
        paint: colorPaint(f.color, f.opacity),
      })),
      strokes: spec.strokes.map((s) => ({
        output: s.output,
        paint: strokePaint(s.color, s.width, s.opacity),
      })),
    });
    legend.push({
      id: spec.id,
      label: spec.label,
      decimals: format?.decimals ?? -1,
      compact: format?.compact ?? false,
      values: spec.legend.map((v) => {
        legendPaints.push(colorPaint(v.color, 1));
        return {
          output: v.output,
          style: INDICATOR_LEGEND_STYLE_VALUE + legendPaints.length - 1,
        };
      }),
    });
  }
  return { items, legend, legendPaints };
}

export function useIndicatorDrawList(
  specs: readonly OverlayRenderSpec[]
): IndicatorDrawList {
  return useMemo(() => createIndicatorDrawList(specs), [specs]);
}
