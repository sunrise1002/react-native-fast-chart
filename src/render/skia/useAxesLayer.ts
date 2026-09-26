import type { SkPath, SkPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { requiredAxisWidth } from '../../axes/AxisWidth';
import { displayDecimals } from '../../axes/PriceFormat';
import { generatePriceTicks } from '../../axes/PriceTicks';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import { layoutPriceAxisLabels } from '../axes/PriceAxisRenderer';
import { layoutTimeAxisLabels } from '../axes/TimeAxisRenderer';
import { buildGridGeometry } from '../grid/GridGeometry';
import { computeLastPriceMarker } from '../overlays/LastPriceRenderer';
import { centeredBaseline } from '../RenderModel';
import { createAxesResources } from './axesResources';
import {
  AXIS_LABEL_PADDING,
  BADGE_PADDING_Y,
  BADGE_RADIUS,
  type AxesFrame,
  type AxesStyle,
} from './axesStyle';
import { cachedPriceLabel, cachedTimeLabels } from './axisLabels';
import { framePriceScale, frameTimeScale } from './frameScales';
import { recordPaneAxes } from './paneAxes';
import type { PaneDrawItem } from './PanePaints';
import { computeTimeTicks, timeLabelSpacing } from './timeAxis';

const NO_PANES: readonly PaneDrawItem[] = [];
const NO_TIME_TICKS = { positions: [] as number[], count: 0 };
const NO_PRICE_TICKS = { values: [] as number[], count: 0 };

export { TIME_LABEL_GAP_EM, timeLabelSpacing } from './timeAxis';

export {
  AXIS_LABEL_PADDING,
  BADGE_PADDING_Y,
  BADGE_RADIUS,
  type AxesFrame,
  type AxesStyle,
} from './axesStyle';

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
  const { series, barSpacing, rightOffset, plotWidth, plotHeight } = state;
  const { priceMin, priceMax, priceAxisWidth, stackHeight } = state;
  const { font, paints, gridLineWidth, pixelRatio, timeAxisHeight } = style;
  const { pricePrecision, thousandsSeparator: sep, timeZone } = style;
  const { priceFormatter, timeFormatter } = style;
  const tickSize = style.tickSize ?? NaN;
  const dailyZone = style.dailyBarsTimeZone === 'chart' ? timeZone : 'utc';
  const resources = useMemo(
    () => createAxesResources(timeZone, dailyZone, gridLineWidth, pixelRatio),
    // The label caches are only valid for one glyph table / separator /
    // formatter pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      timeZone,
      dailyZone,
      font.glyphs,
      sep,
      gridLineWidth,
      pixelRatio,
      priceFormatter,
      timeFormatter,
    ]
  );

  const { showLastPrice, paneScales } = style;
  const panes = style.panes ?? NO_PANES;
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
    const { grid, recorder, priceTicks, timeTicks, marker, caches, rect } =
      resources;
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      data.length,
      resources.time
    );
    const price = framePriceScale(
      plotHeight,
      priceMin,
      priceMax,
      resources.price
    );
    const axisX = time.width;

    // Price ticks + last price.
    generatePriceTicks(
      price.min,
      price.max,
      price.height,
      size,
      priceTicks,
      pricePrecision,
      tickSize
    );
    marker.visible = false;
    const badgeHeight = lineHeight + 2 * BADGE_PADDING_Y;
    if (showLastPrice) {
      computeLastPriceMarker(data, price, badgeHeight, marker);
    }

    // Time ticks (daily+ bars are calendar days in `dailyBarsTimeZone`).
    const withSeconds = computeTimeTicks(
      data,
      time,
      barMs.value,
      spacing,
      resources.timeAxis,
      timeTicks
    );

    // Grid: price rows in the price pane, time columns across all panes.
    grid.reset();
    const gridSink = {
      line(_h: boolean, x: number, y: number, w: number, h: number) {
        rect.x = x;
        rect.y = y;
        rect.width = w;
        rect.height = h;
        grid.addRect(rect);
      },
    };
    const { gridOptions, stack } = resources;
    stack.mode = price.mode;
    stack.min = price.min;
    stack.max = price.max;
    stack.height = stackHeight.value;
    buildGridGeometry(
      time,
      price,
      priceTicks,
      NO_TIME_TICKS,
      gridOptions,
      gridSink
    );
    buildGridGeometry(
      time,
      stack,
      NO_PRICE_TICKS,
      timeTicks,
      gridOptions,
      gridSink
    );

    // Labels.
    const canvas = recorder.beginRecording();
    const sink = {
      text(text: string, x: number, baseline: number) {
        canvas.drawText(text, x, baseline, paints.axisText, skFont);
      },
    };
    const priceLabels = resources.priceLabels.texts;
    let widest = 0;
    for (let i = 0; i < priceTicks.count; i++) {
      priceLabels[i] = cachedPriceLabel(
        caches.price,
        glyphs,
        priceTicks.values[i] as number,
        priceTicks.decimals,
        sep,
        priceFormatter
      );
      widest = Math.max(widest, caches.price.lastWidth);
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
      lastText = cachedPriceLabel(
        caches.price,
        glyphs,
        marker.price,
        displayDecimals(pricePrecision, marker.price),
        sep,
        priceFormatter
      );
      widest = Math.max(widest, caches.price.lastWidth);
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
    const timeLabels = cachedTimeLabels(
      caches.time,
      glyphs,
      timeTicks,
      withSeconds,
      resources.timeLabels,
      timeFormatter,
      barMs.value
    );
    layoutTimeAxisLabels(
      timeTicks,
      timeLabels.texts,
      time,
      {
        top: stack.height,
        height: timeAxisHeight,
        metrics,
        glyphs,
        widths: timeLabels.widths,
      },
      sink
    );
    const paneWidest = recordPaneAxes(panes, paneScales?.value, time, {
      canvas,
      grid,
      font,
      skFont,
      paints,
      gridLineWidth,
      pixelRatio,
      textX: axisX + AXIS_LABEL_PADDING,
      thousandsSeparator: sep,
      ticks: resources.paneTicks,
      cache: caches.pane,
      labels: resources.paneLabels.texts,
    });
    widest = Math.max(widest, paneWidest);
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
