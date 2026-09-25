import { Skia, type SkPaint, type SkPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import { isSeriesAligned } from '../../indicators/UiIndicatorSet';
import { getVisibleRange } from '../../viewport/VisibleRange';
import { buildBandFill, buildLineGeometry } from '../indicators/LineGeometry';
import { framePriceScale, frameTimeScale } from './frameScales';
import type { IndicatorDrawItem, IndicatorDrawList } from './IndicatorPaints';
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
 * series; the node count stays constant regardless of indicators.
 */
export function useIndicatorLayer(
  state: ChartSharedState,
  drawList: IndicatorDrawList,
  profiling: boolean
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
  const { series, indicators, barSpacing, rightOffset } = state;
  const { plotWidth, plotHeight, priceMin, priceMax } = state;
  const { items } = drawList;

  const frame = useDerivedValue<IndicatorFrame>(() => {
    const t0 = profiling ? uiNow() : NaN;
    const data = series.value;
    const set = indicators.value;
    if (items.length === 0 || data.length === 0) {
      return { picture: resources.empty, buildMs: NaN, builtAt: NaN };
    }
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      data.length
    );
    const price = framePriceScale(plotHeight, priceMin, priceMax);
    const range = getVisibleRange(time, RENDER_OVERSCAN_BARS);
    const { builder, recorder } = resources;
    const canvas = recorder.beginRecording();
    // Two passes: every band fill below every line.
    for (let pass = 0; pass < 2; pass++) {
      for (let n = 0; n < items.length; n++) {
        const item = items[n] as IndicatorDrawItem;
        const ui = set.series[item.id];
        if (ui === undefined || !isSeriesAligned(ui, data)) {
          continue;
        }
        const count = pass === 0 ? item.fills.length : item.strokes.length;
        for (let k = 0; k < count; k++) {
          builder.reset();
          let drawn = false;
          let paint: SkPaint;
          if (pass === 0) {
            const fill = item.fills[k] as IndicatorDrawItem['fills'][number];
            const upper = ui.outputs[fill.upper];
            const lower = ui.outputs[fill.lower];
            paint = fill.paint;
            drawn =
              upper !== undefined &&
              lower !== undefined &&
              buildBandFill(
                upper,
                lower,
                ui.length,
                range.startIndex,
                range.endIndex,
                time,
                price,
                builder
              ) > 0;
          } else {
            const stroke = item.strokes[
              k
            ] as IndicatorDrawItem['strokes'][number];
            const values = ui.outputs[stroke.output];
            paint = stroke.paint;
            drawn =
              values !== undefined &&
              buildLineGeometry(
                values,
                ui.length,
                range.startIndex,
                range.endIndex,
                time,
                price,
                builder
              ) > 1;
          }
          const path = builder.detach();
          if (drawn) {
            canvas.drawPath(path, paint);
          }
        }
      }
    }
    return {
      picture: recorder.finishRecordingAsPicture(),
      buildMs: profiling ? uiNow() - t0 : NaN,
      builtAt: t0,
    };
  });

  return { frame, picture: useDerivedValue(() => frame.value.picture) };
}
