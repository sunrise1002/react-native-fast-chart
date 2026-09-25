import { Skia, type SkPath, type SkPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { MS_PER_DAY, MS_PER_MINUTE } from '../../axes/CivilTime';
import { requiredAxisWidth } from '../../axes/AxisWidth';
import { displayDecimals, formatPrice } from '../../axes/PriceFormat';
import { createPriceTicks, generatePriceTicks } from '../../axes/PriceTicks';
import { measureText } from '../../axes/TextMetrics';
import { formatTimeTick } from '../../axes/TimeFormat';
import {
  createTimeTicks,
  generateTimeTicks,
  selectTimeInterval,
} from '../../axes/TimeTicks';
import { createOffsetResolver, type ChartTimeZone } from '../../axes/TimeZone';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import { getVisibleRange } from '../../viewport/VisibleRange';
import { layoutPriceAxisLabels } from '../axes/PriceAxisRenderer';
import { layoutTimeAxisLabels } from '../axes/TimeAxisRenderer';
import { buildGridGeometry } from '../grid/GridGeometry';
import {
  computeLastPriceMarker,
  createLastPriceMarker,
} from '../overlays/LastPriceRenderer';
import { centeredBaseline } from '../RenderModel';
import { framePriceScale, frameTimeScale } from './frameScales';
import type { ChartFont, ChartPaints } from './SkiaResources';

/** Horizontal padding of price labels / badges inside the axis, dp. */
export const AXIS_LABEL_PADDING = 6;
/** Vertical padding of axis badges, dp. */
export const BADGE_PADDING_Y = 3;
/** Corner radius of axis badges, dp. */
export const BADGE_RADIUS = 2;
/** Extra room between time labels, in font sizes. */
export const TIME_LABEL_GAP_EM = 1.5;

export interface AxesStyle {
  font: ChartFont;
  paints: ChartPaints;
  gridLineWidth: number;
  pixelRatio: number;
  timeAxisHeight: number;
  /** Fixed decimals, or `NaN` for automatic. */
  pricePrecision: number;
  thousandsSeparator: string;
  timeZone: ChartTimeZone;
  showLastPrice: boolean;
}

/** One frame of the axes layer. */
export interface AxesFrame {
  /** Grid lines from the axis ticks (spec §19.3). */
  grid: SkPath;
  /** Price / time labels, last-price line and badge. */
  picture: SkPicture;
  /** Axis width that fits this frame's widest label, dp. */
  requiredAxisWidth: number;
}

/** Minimum spacing between time labels for the widest possible label. */
export function timeLabelSpacing(
  font: ChartFont,
  withSeconds: boolean
): number {
  const samples = [withSeconds ? '00:00:00' : '00:00', '0000', 'May', '00'];
  let widest = 0;
  for (const text of samples) {
    widest = Math.max(widest, measureText(font.glyphs, text));
  }
  return widest + font.size * TIME_LABEL_GAP_EM;
}

/**
 * Builds the grid path and the axes picture on the UI thread in one pass
 * per viewport / price-range / data change: price ticks → grid rows and
 * right-axis labels; time ticks → grid columns and bottom labels; last
 * price → dashed line + badge (tick labels under the badge are skipped).
 * One path and one picture regardless of the number of labels.
 */
export function useAxesLayer(
  state: ChartSharedState,
  barMs: SharedValue<number>,
  style: AxesStyle
): {
  frame: SharedValue<AxesFrame>;
  grid: SharedValue<SkPath>;
  picture: SharedValue<SkPicture>;
} {
  const resources = useMemo(
    () => ({
      grid: Skia.PathBuilder.Make(),
      recorder: Skia.PictureRecorder(),
    }),
    []
  );
  const { series, barSpacing, rightOffset, plotWidth, plotHeight } = state;
  const { priceMin, priceMax, priceAxisWidth } = state;
  const { font, paints, gridLineWidth, pixelRatio, timeAxisHeight } = style;
  const { pricePrecision, thousandsSeparator: sep, timeZone } = style;
  const { showLastPrice } = style;
  const spacing = useMemo(
    () => ({
      clock: timeLabelSpacing(font, false),
      seconds: timeLabelSpacing(font, true),
    }),
    [font]
  );
  const { font: skFont, glyphs, metrics, lineHeight, size } = font;

  const frame = useDerivedValue<AxesFrame>(() => {
    const data = series.value;
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      data.length
    );
    const price = framePriceScale(plotHeight, priceMin, priceMax);
    const axisX = time.width;
    const { grid, recorder } = resources;

    // Price ticks + last price.
    const priceTicks = createPriceTicks();
    generatePriceTicks(
      price.min,
      price.max,
      price.height,
      size,
      priceTicks,
      pricePrecision
    );
    const marker = createLastPriceMarker();
    const badgeHeight = lineHeight + 2 * BADGE_PADDING_Y;
    if (showLastPrice) {
      computeLastPriceMarker(data, price, badgeHeight, marker);
    }

    // Time ticks (daily+ bars are calendar days: UTC dates).
    const ms = barMs.value;
    const withSeconds = ms < MS_PER_MINUTE;
    const minSpacing = withSeconds ? spacing.seconds : spacing.clock;
    const timeTicks = createTimeTicks();
    const k = selectTimeInterval(ms, time.barSpacing, minSpacing);
    if (k >= 0) {
      const minBars = minSpacing / time.barSpacing;
      const range = getVisibleRange(time, Math.ceil(minBars) + 1);
      generateTimeTicks(
        data,
        range.startIndex,
        range.endIndex,
        k,
        createOffsetResolver(ms >= MS_PER_DAY ? 'utc' : timeZone),
        minBars,
        timeTicks
      );
    }

    // Grid.
    grid.reset();
    const rect = { x: 0, y: 0, width: 0, height: 0 };
    buildGridGeometry(
      time,
      price,
      priceTicks,
      timeTicks,
      { lineWidth: gridLineWidth, pixelRatio },
      {
        line(_horizontal, x, y, w, h) {
          rect.x = x;
          rect.y = y;
          rect.width = w;
          rect.height = h;
          grid.addRect(rect);
        },
      }
    );

    // Labels.
    const canvas = recorder.beginRecording();
    const sink = {
      text(text: string, x: number, baseline: number) {
        canvas.drawText(text, x, baseline, paints.axisText, skFont);
      },
    };
    const priceLabels: string[] = [];
    let widest = 0;
    for (let i = 0; i < priceTicks.count; i++) {
      const text = formatPrice(
        priceTicks.values[i] as number,
        priceTicks.decimals,
        sep
      );
      priceLabels.push(text);
      widest = Math.max(widest, measureText(glyphs, text));
    }
    let lastText = '';
    if (marker.visible) {
      const bullish = marker.bullish;
      if (!Number.isNaN(marker.lineY)) {
        const y = (Math.floor(marker.lineY * pixelRatio) + 0.5) / pixelRatio;
        canvas.drawLine(
          0,
          y,
          axisX,
          y,
          bullish ? paints.lastPriceLineUp : paints.lastPriceLineDown
        );
      }
      lastText = formatPrice(
        marker.price,
        displayDecimals(pricePrecision, marker.price),
        sep
      );
      widest = Math.max(widest, measureText(glyphs, lastText));
    }
    layoutPriceAxisLabels(
      priceTicks,
      priceLabels,
      price,
      { textX: axisX + AXIS_LABEL_PADDING, metrics, gap: 2 },
      marker.visible
        ? { top: marker.badgeTop, bottom: marker.badgeTop + badgeHeight }
        : null,
      sink
    );
    const timeLabels: string[] = [];
    for (let i = 0; i < timeTicks.count; i++) {
      timeLabels.push(
        formatTimeTick(
          timeTicks.payload[i] as number,
          timeTicks.weights[i] as number,
          withSeconds
        )
      );
    }
    layoutTimeAxisLabels(
      timeTicks,
      timeLabels,
      time,
      { top: price.height, height: timeAxisHeight, metrics, glyphs },
      sink
    );
    if (marker.visible) {
      canvas.drawRRect(
        {
          rect: {
            x: axisX,
            y: marker.badgeTop,
            width: priceAxisWidth.value,
            height: badgeHeight,
          },
          rx: BADGE_RADIUS,
          ry: BADGE_RADIUS,
        },
        marker.bullish ? paints.bullish : paints.bearish
      );
      canvas.drawText(
        lastText,
        axisX + AXIS_LABEL_PADDING,
        centeredBaseline(marker.badgeTop + badgeHeight / 2, metrics),
        paints.lastPriceText,
        skFont
      );
    }

    return {
      grid: grid.detach(),
      picture: recorder.finishRecordingAsPicture(),
      requiredAxisWidth: requiredAxisWidth(widest, AXIS_LABEL_PADDING),
    };
  });

  return {
    frame,
    grid: useDerivedValue(() => frame.value.grid),
    picture: useDerivedValue(() => frame.value.picture),
  };
}
