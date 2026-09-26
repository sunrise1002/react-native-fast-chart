import { Skia, type SkPath } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import { getVisibleRange } from '../../viewport/VisibleRange';
import {
  buildCandleGeometry,
  computeCandleMetrics,
  type CandleSeriesView,
} from '../candles/CandleGeometry';
import {
  conflateVisibleCandles,
  frameGroupSize,
} from '../conflation/ConflatedLayers';
import { framePriceScale, frameTimeScale } from './frameScales';
import { uiNow } from './uiClock';

export interface CandleStyle {
  bodyRatio: number;
  wickWidth: number;
  pixelRatio: number;
  /** Min bucket width before conflating, device px (`0` = off). */
  conflationPx: number;
  /** Measure the path build time (`CandleFrame.buildMs`). */
  profiling: boolean;
}

/** One frame of batched candle geometry (spec §17.2): exactly 4 paths. */
export interface CandleFrame {
  bullBodies: SkPath;
  bearBodies: SkPath;
  bullWicks: SkPath;
  bearWicks: SkPath;
  /** Candles (or conflated buckets) drawn this frame. */
  bars: number;
  /** Bars per drawn bucket (`1` = no conflation). */
  group: number;
  /** Path build time, ms (`NaN` unless profiling). */
  buildMs: number;
  /** UI clock at build start, ms (`NaN` unless profiling). */
  builtAt: number;
}

/** Bars rendered beyond each plot edge (paths are rebuilt every frame). */
export const RENDER_OVERSCAN_BARS = 1;

/**
 * Builds the four candle paths on the UI thread whenever the viewport,
 * price range or data changes — no React render involved.
 *
 * Allocation strategy (Skia 2.6): four `SkPathBuilder`s are created once
 * and reused; each frame they are refilled and `detach()`ed into immutable
 * `SkPath`s (detach hands over the storage and resets the builder, cheaper
 * than `build()`). New path objects per frame are required anyway — a
 * shared value only notifies Skia when its value identity changes — and
 * Skia may still reference the previous frame's paths while recording.
 * Rects are appended via `addRect` with one reused plain rect object (1
 * JSI call per rect instead of 5 for moveTo/lineTo/close).
 *
 * Per-frame scratch (time / price scale, metrics, range, rect) lives in
 * `state.renderCache` (P8 allocation audit). At extreme zoom-out the
 * visible bars are conflated into pixel buckets (`frameGroupSize`), so a
 * frame costs O(plot px) whatever the number of bars in view.
 */
export function useCandlePaths(
  state: ChartSharedState,
  style: CandleStyle
): {
  frame: SharedValue<CandleFrame>;
  bullBodies: SharedValue<SkPath>;
  bearBodies: SharedValue<SkPath>;
  bullWicks: SharedValue<SkPath>;
  bearWicks: SharedValue<SkPath>;
} {
  const builders = useMemo(
    () => ({
      bullBodies: Skia.PathBuilder.Make(),
      bearBodies: Skia.PathBuilder.Make(),
      bullWicks: Skia.PathBuilder.Make(),
      bearWicks: Skia.PathBuilder.Make(),
    }),
    []
  );
  const { series, barSpacing, rightOffset, plotWidth, plotHeight } = state;
  const { priceMin, priceMax, renderCache } = state;
  const { bodyRatio, wickWidth, pixelRatio, conflationPx, profiling } = style;

  const frame = useDerivedValue<CandleFrame>(() => {
    const t0 = profiling ? uiNow() : NaN;
    const data = series.value;
    const cache = renderCache.value;
    const scratch = cache.frame;
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      data.length,
      scratch.time
    );
    const price = framePriceScale(
      plotHeight,
      priceMin,
      priceMax,
      scratch.price
    );
    const range = getVisibleRange(time, RENDER_OVERSCAN_BARS, scratch.range);
    const group = frameGroupSize(
      time.barSpacing,
      conflationPx,
      wickWidth,
      pixelRatio
    );
    let source: CandleSeriesView = data;
    let sourceTime = time;
    let start = range.startIndex;
    let end = range.endIndex;
    if (group > 1) {
      const buckets = conflateVisibleCandles(
        cache,
        data,
        start,
        end,
        time,
        group
      );
      source = buckets;
      sourceTime = buckets.scale;
      start = 0;
      end = buckets.length - 1;
    }
    const metrics = computeCandleMetrics(
      sourceTime.barSpacing,
      bodyRatio,
      wickWidth,
      pixelRatio,
      scratch.metrics
    );
    const { bullBodies, bearBodies, bullWicks, bearWicks } = builders;
    bullBodies.reset();
    bearBodies.reset();
    bullWicks.reset();
    bearWicks.reset();
    const rect = scratch.rect;
    const bars = buildCandleGeometry(
      source,
      start,
      end,
      sourceTime,
      price,
      metrics,
      {
        body(bullish, x, y, w, h) {
          rect.x = x;
          rect.y = y;
          rect.width = w;
          rect.height = h;
          (bullish ? bullBodies : bearBodies).addRect(rect);
        },
        wick(bullish, x, y, w, h) {
          rect.x = x;
          rect.y = y;
          rect.width = w;
          rect.height = h;
          (bullish ? bullWicks : bearWicks).addRect(rect);
        },
      }
    );
    return {
      bullBodies: bullBodies.detach(),
      bearBodies: bearBodies.detach(),
      bullWicks: bullWicks.detach(),
      bearWicks: bearWicks.detach(),
      bars,
      group,
      buildMs: profiling ? uiNow() - t0 : NaN,
      builtAt: t0,
    };
  });

  return {
    frame,
    bullBodies: useDerivedValue(() => frame.value.bullBodies),
    bearBodies: useDerivedValue(() => frame.value.bearBodies),
    bullWicks: useDerivedValue(() => frame.value.bullWicks),
    bearWicks: useDerivedValue(() => frame.value.bearWicks),
  };
}
