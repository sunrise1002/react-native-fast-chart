import { Skia, type SkPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { MS_PER_DAY } from '../../axes/CivilTime';
import {
  applyPriceFormatter,
  applyTimeFormatter,
  TIME_LABEL_CROSSHAIR,
  type PriceFormatter,
  type TimeFormatter,
} from '../../axes/Formatters';
import { clampSpan } from '../../axes/LabelCollision';
import { displayDecimals } from '../../axes/PriceFormat';
import { measureText } from '../../axes/TextMetrics';
import {
  createOffsetResolver,
  offsetAt,
  type ChartTimeZone,
} from '../../axes/TimeZone';
import type { DailyBarsTimeZone } from '../../core/ChartConfig';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import { paneIndexAt } from '../../panes/PaneLayout';
import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import {
  computeCrosshair,
  createCrosshairFrame,
} from '../overlays/CrosshairRenderer';
import { formatIndicatorValue } from '../overlays/IndicatorLegendRenderer';
import { centeredBaseline } from '../RenderModel';
import { framePriceScale, frameTimeScale } from './frameScales';
import type { IndicatorDrawList } from './IndicatorPaints';
import type { PaneDrawItem } from './PanePaints';
import type { ChartFont, ChartPaints } from './SkiaResources';
import {
  AXIS_LABEL_PADDING,
  BADGE_PADDING_Y,
  BADGE_RADIUS,
} from './useAxesLayer';
import { useLegendLayer } from './useLegendLayer';
import type { PaneScaleFrame } from './usePaneScales';

export { LEGEND_INSET } from './useLegendLayer';

export interface OverlayStyle {
  font: ChartFont;
  paints: ChartPaints;
  pixelRatio: number;
  timeAxisHeight: number;
  pricePrecision: number;
  thousandsSeparator: string;
  timeZone: ChartTimeZone;
  /** Calendar zone of daily+ bars (default `'utc'`). */
  dailyBarsTimeZone?: DailyBarsTimeZone;
  /** Decimals of unscaled legend volumes (`NaN` = automatic). */
  volumeDecimals?: number;
  priceFormatter?: PriceFormatter;
  timeFormatter?: TimeFormatter;
  showLegend: boolean;
  showLegendVolume: boolean;
  /** Overlay indicators listed under the OHLC row (with their values). */
  indicators?: IndicatorDrawList;
  /** Indicator panes (legends, crosshair value labels). */
  panes?: readonly PaneDrawItem[];
  paneScales?: SharedValue<PaneScaleFrame>;
}

const NO_PANES: readonly PaneDrawItem[] = [];

function emptyPicture(): SkPicture {
  const recorder = Skia.PictureRecorder();
  recorder.beginRecording();
  return recorder.finishRecordingAsPicture();
}

/**
 * Crosshair picture and legend picture, rebuilt on the UI thread from
 * shared values only (spec §18.3: no React state per move). The vertical
 * line spans every pane; the horizontal line and the value label belong
 * to the pane under the finger, on that pane's scale and value format
 * (spec §12: shared time scale, independent Y scales). The legend only
 * depends on the data and the crosshair bar, so panning without a
 * crosshair doesn't re-record it.
 */
export function useOverlayLayer(
  state: ChartSharedState,
  barMs: SharedValue<number>,
  style: OverlayStyle
): { crosshair: SharedValue<SkPicture>; legend: SharedValue<SkPicture> } {
  const { timeZone, priceFormatter, timeFormatter } = style;
  const dailyZone = style.dailyBarsTimeZone === 'chart' ? timeZone : 'utc';
  // Reused per crosshair frame (P8 allocation audit).
  const resources = useMemo(
    () => ({
      crosshair: Skia.PictureRecorder(),
      empty: emptyPicture(),
      frame: createCrosshairFrame(),
      time: { width: 0, barSpacing: 0, rightOffset: 0, barCount: 0 },
      price: {
        mode: 'linear' as PriceScaleSnapshot['mode'],
        top: 0,
        height: 0,
        min: NaN,
        max: NaN,
      },
      zone: createOffsetResolver(timeZone),
      daily: createOffsetResolver(dailyZone),
    }),
    [timeZone, dailyZone]
  );
  const { series, barSpacing, rightOffset, plotWidth, plotHeight } = state;
  const { priceMin, priceMax, priceAxisWidth } = state;
  const { stackHeight, paneLayout } = state;
  const { crosshairIndex, crosshairY, crosshairOpacity } = state;
  const { font, paints, pixelRatio, timeAxisHeight } = style;
  const { pricePrecision, thousandsSeparator: sep } = style;
  const { paneScales } = style;
  const panes = style.panes ?? NO_PANES;
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
      data.length,
      resources.time
    );
    const layout = paneLayout.value;
    const fingerY = crosshairY.value;
    const lastClose = data.close[data.offset + data.length - 1] as number;

    // Scale / format of the pane under the finger.
    let price: PriceScaleSnapshot = framePriceScale(
      plotHeight,
      priceMin,
      priceMax,
      resources.price
    );
    let valueDecimals = displayDecimals(pricePrecision, lastClose);
    let compact = false;
    let hasScale = true;
    const pane = paneIndexAt(layout, fingerY);
    if (pane > 0) {
      const id = layout.ids[pane] as string;
      let scale: PriceScaleSnapshot | undefined;
      for (let j = 0; j < panes.length; j++) {
        const item = panes[j] as PaneDrawItem;
        if (!item.overlay && item.paneId === id) {
          scale = paneScales?.value.scales[j];
          valueDecimals = item.format.decimals;
          compact = item.format.compact;
          break;
        }
      }
      hasScale = scale !== undefined && Number.isFinite(scale.min);
      price =
        scale !== undefined && hasScale
          ? scale
          : {
              mode: 'linear',
              top: layout.tops[pane] as number,
              height: layout.heights[pane] as number,
              min: 0,
              max: 1,
            };
    }
    const ch = resources.frame;
    if (
      !computeCrosshair(
        data,
        time,
        price,
        crosshairIndex.value,
        fingerY,
        pixelRatio,
        ch
      )
    ) {
      return resources.empty;
    }
    const stack = stackHeight.value > 0 ? stackHeight.value : price.height;
    const canvas = resources.crosshair.beginRecording();
    const line = paints.crosshairLine;
    canvas.drawLine(ch.x, 0, ch.x, stack, line);
    const boxHeight = lineHeight + 2 * BADGE_PADDING_Y;

    if (hasScale) {
      canvas.drawLine(0, ch.y, time.width, ch.y, line);
      // Value label on the pane's axis (price pane: symbol formatter).
      const text =
        pane > 0
          ? formatIndicatorValue(
              ch.price,
              valueDecimals,
              compact,
              displayDecimals(NaN, ch.price),
              sep
            )
          : applyPriceFormatter(priceFormatter, ch.price, valueDecimals, sep);
      const top = clampSpan(
        ch.y,
        boxHeight,
        price.top,
        price.top + price.height
      );
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
        text,
        time.width + AXIS_LABEL_PADDING,
        centeredBaseline(top + boxHeight / 2, metrics),
        paints.crosshairText,
        skFont
      );
    }

    // Time label on the time axis.
    const ms = barMs.value;
    const resolver = ms >= MS_PER_DAY ? resources.daily : resources.zone;
    const timeText = applyTimeFormatter(
      timeFormatter,
      ch.time + offsetAt(resolver, ch.time),
      TIME_LABEL_CROSSHAIR,
      ms,
      false
    );
    const width = measureText(glyphs, timeText) + 2 * AXIS_LABEL_PADDING;
    const left = clampSpan(ch.x, width, 0, time.width);
    const labelTop = stack + (timeAxisHeight - boxHeight) / 2;
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

  const legend = useLegendLayer(state, {
    font,
    paints,
    pricePrecision,
    volumeDecimals: style.volumeDecimals,
    priceFormatter,
    thousandsSeparator: sep,
    showLegend: style.showLegend,
    showLegendVolume: style.showLegendVolume,
    indicators: style.indicators,
    panes,
  });

  return { crosshair, legend };
}
