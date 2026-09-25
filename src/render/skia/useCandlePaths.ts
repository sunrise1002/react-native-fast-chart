import { Skia, type SkPath } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import { getVisibleRange } from '../../viewport/VisibleRange';
import {
  buildCandleGeometry,
  computeCandleMetrics,
  createCandleMetrics,
} from '../candles/CandleGeometry';
import { framePriceScale, frameTimeScale } from './frameScales';
import { uiNow } from './uiClock';

export interface CandleStyle {
  bodyRatio: number;
  wickWidth: number;
  pixelRatio: number;
  /** Measure the path build time (`CandleFrame.buildMs`). */
  profiling: boolean;
}

/** One frame of batched candle geometry (spec §17.2): exactly 4 paths. */
export interface CandleFrame {
  bullBodies: SkPath;
  bearBodies: SkPath;
  bullWicks: SkPath;
  bearWicks: SkPath;
  /** Bars drawn this frame. */
  bars: number;
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
  const { priceMin, priceMax } = state;
  const { bodyRatio, wickWidth, pixelRatio, profiling } = style;

  const frame = useDerivedValue<CandleFrame>(() => {
    const t0 = profiling ? uiNow() : NaN;
    const data = series.value;
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      data.length
    );
    const price = framePriceScale(plotHeight, priceMin, priceMax);
    const metrics = computeCandleMetrics(
      time.barSpacing,
      bodyRatio,
      wickWidth,
      pixelRatio,
      createCandleMetrics()
    );
    const range = getVisibleRange(time, RENDER_OVERSCAN_BARS);
    const { bullBodies, bearBodies, bullWicks, bearWicks } = builders;
    bullBodies.reset();
    bearBodies.reset();
    bullWicks.reset();
    bearWicks.reset();
    const rect = { x: 0, y: 0, width: 0, height: 0 };
    const bars = buildCandleGeometry(
      data,
      range.startIndex,
      range.endIndex,
      time,
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
