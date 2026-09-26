import type {
  SkCanvas,
  SkPaint,
  SkPathBuilder,
} from '@shopify/react-native-skia';
import type { UiCandleSeries } from '../../data/UiCandleSeries';
import {
  isSeriesAligned,
  type UiIndicatorSet,
} from '../../indicators/UiIndicatorSet';
import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import type { TimeScaleState } from '../../viewport/TimeScale';
import type { VisibleRange } from '../../viewport/VisibleRange';
import { buildBandFill, buildLineGeometry } from '../indicators/LineGeometry';
import type { IndicatorDrawItem } from './IndicatorPaints';

/**
 * Records the band fills (first pass) and strokes (second pass) of
 * `items` on `price`'s scale: one path per series, refilled from the
 * shared `builder` and `detach()`ed. Worklet (UI thread, per frame).
 */
export function recordIndicatorItems(
  canvas: SkCanvas,
  builder: SkPathBuilder,
  items: readonly IndicatorDrawItem[],
  set: UiIndicatorSet,
  data: UiCandleSeries,
  range: VisibleRange,
  time: TimeScaleState,
  price: PriceScaleSnapshot
): void {
  'worklet';
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
}
