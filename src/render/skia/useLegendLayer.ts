import {
  Skia,
  type SkCanvas,
  type SkPicture,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { PriceFormatter } from '../../axes/Formatters';
import { displayDecimals } from '../../axes/PriceFormat';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import {
  INDICATOR_LEGEND_STYLE_CAPTION,
  INDICATOR_LEGEND_STYLE_VALUE,
  layoutIndicatorLegend,
  type IndicatorLegendItem,
  type IndicatorLegendLayout,
} from '../overlays/IndicatorLegendRenderer';
import {
  layoutOhlcHeader,
  OHLC_STYLE_CAPTION,
  OHLC_STYLE_UP,
} from '../overlays/OHLCHeaderRenderer';
import { centeredBaseline } from '../RenderModel';
import type { IndicatorDrawList } from './IndicatorPaints';
import type { PaneDrawItem } from './PanePaints';
import type { ChartFont, ChartPaints } from './SkiaResources';

/** Legend inset from a pane's top-left corner, dp. */
export const LEGEND_INSET = 8;

export interface LegendStyle {
  font: ChartFont;
  paints: ChartPaints;
  pricePrecision: number;
  /** Decimals of unscaled legend volumes (`NaN` = automatic). */
  volumeDecimals?: number;
  priceFormatter?: PriceFormatter;
  thousandsSeparator: string;
  showLegend: boolean;
  showLegendVolume: boolean;
  /** Price-pane overlays listed under the OHLC row. */
  indicators?: IndicatorDrawList;
  /** Indicator panes: one legend per pane, at its top-left corner. */
  panes?: readonly PaneDrawItem[];
}

const EMPTY_PANES: readonly PaneDrawItem[] = [];

function drawIndicatorRows(
  canvas: SkCanvas,
  items: readonly IndicatorLegendItem[],
  paints: IndicatorDrawList['legendPaints'],
  chart: ChartPaints,
  font: ChartFont,
  draw: (sink: {
    text(text: string, x: number, baseline: number, style: number): void;
  }) => number
): number {
  'worklet';
  if (items.length === 0) {
    return 0;
  }
  return draw({
    text(text, x, baseline, style) {
      canvas.drawText(
        text,
        x,
        baseline,
        style === INDICATOR_LEGEND_STYLE_CAPTION
          ? chart.axisText
          : (paints[style - INDICATOR_LEGEND_STYLE_VALUE] ?? chart.axisText),
        font.font
      );
    },
  });
}

/**
 * Legend picture (TradingView style) rebuilt on the UI thread: OHLC row
 * and price-pane overlay rows at the top-left of the price pane, then one
 * legend per indicator pane (name, params and values) at its own
 * top-left. Values follow the crosshair bar, otherwise the last bar.
 */
export function useLegendLayer(
  state: ChartSharedState,
  style: LegendStyle
): SharedValue<SkPicture> {
  const resources = useMemo(() => {
    const recorder = Skia.PictureRecorder();
    recorder.beginRecording();
    return { recorder, empty: recorder.finishRecordingAsPicture() };
  }, []);
  const { series, plotWidth, indicators, paneLayout } = state;
  const { crosshairIndex, crosshairOpacity } = state;
  const { font, paints, pricePrecision, thousandsSeparator: sep } = style;
  const { showLegend, showLegendVolume, indicators: overlays } = style;
  const { priceFormatter } = style;
  const volumeDecimals = style.volumeDecimals ?? NaN;
  const panes = style.panes ?? EMPTY_PANES;
  const { glyphs, metrics, lineHeight } = font;

  return useDerivedValue<SkPicture>(() => {
    const data = series.value;
    if (!showLegend || data.length === 0) {
      return resources.empty;
    }
    const index =
      crosshairOpacity.value > 0 && crosshairIndex.value >= 0
        ? crosshairIndex.value
        : data.length - 1;
    const set = indicators.value;
    const layout = paneLayout.value;
    const canvas = resources.recorder.beginRecording();
    const rowHeight = lineHeight + 2;
    const baselineOffset = centeredBaseline(rowHeight / 2, metrics);
    const decimals = displayDecimals(
      pricePrecision,
      data.close[data.offset + data.length - 1] as number
    );
    const rows = (y: number): IndicatorLegendLayout => ({
      x: LEGEND_INSET,
      y,
      lineHeight: rowHeight,
      baselineOffset,
      maxWidth: plotWidth.value - LEGEND_INSET,
      gap: 6,
      glyphs,
      decimals,
      thousandsSeparator: sep,
    });
    let lines = layoutOhlcHeader(
      data,
      index,
      {
        x: LEGEND_INSET,
        y: LEGEND_INSET,
        lineHeight: rowHeight,
        baselineOffset,
        maxWidth: plotWidth.value - LEGEND_INSET,
        captionGap: 3,
        groupGap: 8,
        glyphs,
        decimals,
        thousandsSeparator: sep,
        showVolume: showLegendVolume,
        volumeDecimals,
        priceFormatter,
      },
      {
        text(text, x, baseline, textStyle) {
          canvas.drawText(
            text,
            x,
            baseline,
            textStyle === OHLC_STYLE_CAPTION
              ? paints.axisText
              : textStyle === OHLC_STYLE_UP
                ? paints.legendUp
                : paints.legendDown,
            font.font
          );
        },
      }
    );
    if (overlays !== undefined) {
      const y = LEGEND_INSET + lines * rowHeight;
      lines += drawIndicatorRows(
        canvas,
        overlays.legend,
        overlays.legendPaints,
        paints,
        font,
        (sink) =>
          layoutIndicatorLegend(
            overlays.legend,
            set,
            data,
            index,
            rows(y),
            sink
          )
      );
    }
    for (let i = 0; i < panes.length; i++) {
      const item = panes[i] as PaneDrawItem;
      const p = layout.ids.indexOf(item.paneId);
      if (p < 0 || !((layout.heights[p] as number) > rowHeight)) {
        continue;
      }
      // Price-pane overlays continue the price legend.
      const y = item.overlay
        ? LEGEND_INSET + lines * rowHeight
        : (layout.tops[p] as number) + LEGEND_INSET / 2;
      const used = drawIndicatorRows(
        canvas,
        item.list.legend,
        item.list.legendPaints,
        paints,
        font,
        (sink) =>
          layoutIndicatorLegend(
            item.list.legend,
            set,
            data,
            index,
            rows(y),
            sink
          )
      );
      if (item.overlay) {
        lines += used;
      }
    }
    return resources.recorder.finishRecordingAsPicture();
  });
}
