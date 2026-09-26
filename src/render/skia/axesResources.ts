import { Skia } from '@shopify/react-native-skia';
import { createPriceTicks, PRICE_TICK_CAPACITY } from '../../axes/PriceTicks';
import { createTimeTicks, TIME_TICK_CAPACITY } from '../../axes/TimeTicks';
import { createOffsetResolver, type ChartTimeZone } from '../../axes/TimeZone';
import type { MutablePriceScale } from '../conflation/RenderCache';
import { createLastPriceMarker } from '../overlays/LastPriceRenderer';
import { createAxisLabelCaches, createLabelBuffer } from './axisLabels';

function scratchPriceScale(): MutablePriceScale {
  return { mode: 'linear', top: 0, height: 0, min: NaN, max: NaN };
}

/**
 * Everything the axes mapper reuses from frame to frame (P8 allocation
 * audit): Skia builders, tick / label buffers (their capacities cap the
 * tick counts), the last-price marker, offset resolvers, label caches and
 * scale scratch. Created on the JS thread; the mapper's captured copy is
 * mutated on the UI thread only.
 */
export function createAxesResources(
  timeZone: ChartTimeZone,
  gridLineWidth: number,
  pixelRatio: number
) {
  return {
    grid: Skia.PathBuilder.Make(),
    recorder: Skia.PictureRecorder(),
    priceTicks: createPriceTicks(),
    paneTicks: createPriceTicks(),
    timeTicks: createTimeTicks(),
    marker: createLastPriceMarker(),
    timeAxis: {
      zone: createOffsetResolver(timeZone),
      utc: createOffsetResolver('utc'),
      range: { startIndex: 0, endIndex: -1 },
    },
    caches: createAxisLabelCaches(),
    priceLabels: createLabelBuffer(PRICE_TICK_CAPACITY),
    timeLabels: createLabelBuffer(TIME_TICK_CAPACITY),
    paneLabels: createLabelBuffer(PRICE_TICK_CAPACITY),
    time: { width: 0, barSpacing: 0, rightOffset: 0, barCount: 0 },
    price: scratchPriceScale(),
    stack: scratchPriceScale(),
    rect: { x: 0, y: 0, width: 0, height: 0 },
    gridOptions: { lineWidth: gridLineWidth, pixelRatio },
  };
}

export type AxesResources = ReturnType<typeof createAxesResources>;
