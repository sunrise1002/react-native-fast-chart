import { Skia, type SkPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import { getVisibleRange } from '../../viewport/VisibleRange';
import {
  frameGroupSize,
  NO_CONFLATION,
  type ConflationStyle,
} from '../conflation/ConflatedLayers';
import { framePriceScale, frameTimeScale } from './frameScales';
import type { IndicatorDrawList } from './IndicatorPaints';
import { recordIndicatorItems } from './indicatorDrawing';
import { uiNow } from './uiClock';
import { RENDER_OVERSCAN_BARS } from './useCandlePaths';

/** One frame of overlay indicators: a single picture for all series. */
export interface IndicatorFrame {
  picture: SkPicture;
  /** Build time, ms (`NaN` unless profiling). */
  buildMs: number;
  /** UI clock at build start (`NaN` unless profiling). */
  builtAt: number;
}

/**
 * Records every overlay (band fills first, then strokes) into one
 * `SkPicture` on the UI thread whenever the viewport, price range, data or
 * indicator values change (spec §17.3: visible slice → one path per
 * series). One reused `SkPathBuilder` is refilled and `detach()`ed per
 * series; the node count stays constant regardless of indicators. At
 * extreme zoom-out series are drawn from per-bucket envelopes
 * (`conflation`, same buckets as the candles).
 */
export function useIndicatorLayer(
  state: ChartSharedState,
  drawList: IndicatorDrawList,
  profiling: boolean,
  conflation: ConflationStyle = NO_CONFLATION
): { frame: SharedValue<IndicatorFrame>; picture: SharedValue<SkPicture> } {
  const resources = useMemo(() => {
    const recorder = Skia.PictureRecorder();
    recorder.beginRecording();
    return {
      recorder,
      builder: Skia.PathBuilder.Make(),
      empty: recorder.finishRecordingAsPicture(),
    };
  }, []);
  const { series, indicators, barSpacing, rightOffset, renderCache } = state;
  const { conflationPx, wickWidth, pixelRatio } = conflation;
  const { plotWidth, plotHeight, priceMin, priceMax } = state;
  const { items } = drawList;

  const frame = useDerivedValue<IndicatorFrame>(() => {
    const t0 = profiling ? uiNow() : NaN;
    const data = series.value;
    const set = indicators.value;
    if (items.length === 0 || data.length === 0) {
      return { picture: resources.empty, buildMs: NaN, builtAt: NaN };
    }
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
    const { builder, recorder } = resources;
    const canvas = recorder.beginRecording();
    recordIndicatorItems(
      canvas,
      builder,
      items,
      { set, data, range, time, group, cache },
      price
    );
    return {
      picture: recorder.finishRecordingAsPicture(),
      buildMs: profiling ? uiNow() - t0 : NaN,
      builtAt: t0,
    };
  });

  return { frame, picture: useDerivedValue(() => frame.value.picture) };
}
