import { Skia, type SkPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { MS_PER_DAY } from '../../axes/CivilTime';
import { clampSpan } from '../../axes/LabelCollision';
import { displayDecimals, formatPrice } from '../../axes/PriceFormat';
import { measureText } from '../../axes/TextMetrics';
import { formatDateTime } from '../../axes/TimeFormat';
import {
  createOffsetResolver,
  offsetAt,
  type ChartTimeZone,
} from '../../axes/TimeZone';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import {
  computeCrosshair,
  createCrosshairFrame,
} from '../overlays/CrosshairRenderer';
import {
  layoutOhlcHeader,
  OHLC_STYLE_CAPTION,
  OHLC_STYLE_UP,
} from '../overlays/OHLCHeaderRenderer';
import { centeredBaseline } from '../RenderModel';
import { framePriceScale, frameTimeScale } from './frameScales';
import type { ChartFont, ChartPaints } from './SkiaResources';
import {
  AXIS_LABEL_PADDING,
  BADGE_PADDING_Y,
  BADGE_RADIUS,
} from './useAxesLayer';

/** Legend inset from the plot's top-left corner, dp. */
export const LEGEND_INSET = 8;

export interface OverlayStyle {
  font: ChartFont;
  paints: ChartPaints;
  pixelRatio: number;
  timeAxisHeight: number;
  pricePrecision: number;
  thousandsSeparator: string;
  timeZone: ChartTimeZone;
  showLegend: boolean;
  showLegendVolume: boolean;
}

function emptyPicture(): SkPicture {
  const recorder = Skia.PictureRecorder();
  recorder.beginRecording();
  return recorder.finishRecordingAsPicture();
}

/**
 * Crosshair picture (dashed lines + price / time axis labels) and OHLC
 * legend picture, rebuilt on the UI thread from shared values only
 * (spec §18.3: no React state per move). The crosshair picture depends on
 * the crosshair + viewport values; the legend only on the data and the
 * crosshair bar, so panning without a crosshair doesn't re-record it.
 */
export function useOverlayLayer(
  state: ChartSharedState,
  barMs: SharedValue<number>,
  style: OverlayStyle
): { crosshair: SharedValue<SkPicture>; legend: SharedValue<SkPicture> } {
  const resources = useMemo(
    () => ({
      crosshair: Skia.PictureRecorder(),
      legend: Skia.PictureRecorder(),
      empty: emptyPicture(),
    }),
    []
  );
  const { series, barSpacing, rightOffset, plotWidth, plotHeight } = state;
  const { priceMin, priceMax, priceAxisWidth } = state;
  const { crosshairIndex, crosshairY, crosshairOpacity } = state;
  const { font, paints, pixelRatio, timeAxisHeight } = style;
  const { pricePrecision, thousandsSeparator: sep, timeZone } = style;
  const { showLegend, showLegendVolume } = style;
  const { font: skFont, glyphs, metrics, lineHeight } = font;

  const crosshair = useDerivedValue<SkPicture>(() => {
    if (!(crosshairOpacity.value > 0)) {
      return resources.empty;
    }
    const data = series.value;
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      data.length
    );
    const price = framePriceScale(plotHeight, priceMin, priceMax);
    const ch = createCrosshairFrame();
    if (
      !computeCrosshair(
        data,
        time,
        price,
        crosshairIndex.value,
        crosshairY.value,
        pixelRatio,
        ch
      )
    ) {
      return resources.empty;
    }
    const canvas = resources.crosshair.beginRecording();
    const line = paints.crosshairLine;
    canvas.drawLine(ch.x, 0, ch.x, price.height, line);
    canvas.drawLine(0, ch.y, time.width, ch.y, line);

    const boxHeight = lineHeight + 2 * BADGE_PADDING_Y;
    // Price label on the price axis.
    const lastClose = data.close[data.offset + data.length - 1] as number;
    const priceText = formatPrice(
      ch.price,
      displayDecimals(pricePrecision, lastClose),
      sep
    );
    const top = clampSpan(ch.y, boxHeight, 0, price.height);
    canvas.drawRRect(
      {
        rect: {
          x: time.width,
          y: top,
          width: priceAxisWidth.value,
          height: boxHeight,
        },
        rx: BADGE_RADIUS,
        ry: BADGE_RADIUS,
      },
      paints.crosshairLabel
    );
    canvas.drawText(
      priceText,
      time.width + AXIS_LABEL_PADDING,
      centeredBaseline(top + boxHeight / 2, metrics),
      paints.crosshairText,
      skFont
    );

    // Time label on the time axis.
    const ms = barMs.value;
    const resolver = createOffsetResolver(ms >= MS_PER_DAY ? 'utc' : timeZone);
    const timeText = formatDateTime(ch.time + offsetAt(resolver, ch.time), ms);
    const width = measureText(glyphs, timeText) + 2 * AXIS_LABEL_PADDING;
    const left = clampSpan(ch.x, width, 0, time.width);
    const labelTop = price.height + (timeAxisHeight - boxHeight) / 2;
    canvas.drawRRect(
      {
        rect: { x: left, y: labelTop, width, height: boxHeight },
        rx: BADGE_RADIUS,
        ry: BADGE_RADIUS,
      },
      paints.crosshairLabel
    );
    canvas.drawText(
      timeText,
      left + AXIS_LABEL_PADDING,
      centeredBaseline(labelTop + boxHeight / 2, metrics),
      paints.crosshairText,
      skFont
    );
    return resources.crosshair.finishRecordingAsPicture();
  });

  const legend = useDerivedValue<SkPicture>(() => {
    const data = series.value;
    if (!showLegend || data.length === 0) {
      return resources.empty;
    }
    const index =
      crosshairOpacity.value > 0 && crosshairIndex.value >= 0
        ? crosshairIndex.value
        : data.length - 1;
    const canvas = resources.legend.beginRecording();
    layoutOhlcHeader(
      data,
      index,
      {
        x: LEGEND_INSET,
        y: LEGEND_INSET,
        lineHeight: lineHeight + 2,
        baselineOffset: centeredBaseline((lineHeight + 2) / 2, metrics),
        maxWidth: plotWidth.value - LEGEND_INSET,
        captionGap: 3,
        groupGap: 8,
        glyphs,
        decimals: displayDecimals(
          pricePrecision,
          data.close[data.offset + data.length - 1] as number
        ),
        thousandsSeparator: sep,
        showVolume: showLegendVolume,
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
            skFont
          );
        },
      }
    );
    return resources.legend.finishRecordingAsPicture();
  });

  return { crosshair, legend };
}
