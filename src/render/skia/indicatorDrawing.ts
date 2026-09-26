import type {
  SkCanvas,
  SkPaint,
  SkPathBuilder,
} from '@shopify/react-native-skia';
import type { UiCandleSeries } from '../../data/UiCandleSeries';
import {
  isSeriesAligned,
  type UiIndicatorSeries,
  type UiIndicatorSet,
} from '../../indicators/UiIndicatorSet';
import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import type { TimeScaleState } from '../../viewport/TimeScale';
import type { VisibleRange } from '../../viewport/VisibleRange';
import { conflateOutput } from '../conflation/ConflatedLayers';
import type { RenderCache } from '../conflation/RenderCache';
import { buildEnvelopeLine } from '../conflation/ValueConflation';
import { buildBandFill, buildLineGeometry } from '../indicators/LineGeometry';
import type { IndicatorDrawItem } from './IndicatorPaints';

/** Frame inputs shared by every indicator series of a picture. */
export interface IndicatorFrameContext {
  set: UiIndicatorSet;
  data: UiCandleSeries;
  range: VisibleRange;
  time: TimeScaleState;
  /** Bars per bucket (`1` = draw every bar, see `frameGroupSize`). */
  group: number;
  cache: RenderCache;
}

function fillBand(
  builder: SkPathBuilder,
  fill: IndicatorDrawItem['fills'][number],
  id: string,
  ui: UiIndicatorSeries,
  ctx: IndicatorFrameContext,
  price: PriceScaleSnapshot
): boolean {
  'worklet';
  const upper = ui.outputs[fill.upper];
  const lower = ui.outputs[fill.lower];
  if (upper === undefined || lower === undefined) {
    return false;
  }
  const { range, time, group, cache } = ctx;
  if (group <= 1) {
    const { startIndex, endIndex } = range;
    const len = ui.length;
    return (
      buildBandFill(
        upper,
        lower,
        len,
        startIndex,
        endIndex,
        time,
        price,
        builder
      ) > 0
    );
  }
  // Conflated: the band's outer envelope (max of upper, min of lower).
  const { startIndex, endIndex } = range;
  const hi = cache.values;
  const lo = cache.lower;
  const { set } = ctx;
  const n = conflateOutput(
    cache,
    set,
    id,
    ui,
    fill.upper,
    startIndex,
    endIndex,
    time,
    group,
    hi
  );
  conflateOutput(
    cache,
    set,
    id,
    ui,
    fill.lower,
    startIndex,
    endIndex,
    time,
    group,
    lo
  );
  return (
    buildBandFill(hi.max, lo.min, n, 0, n - 1, hi.scale, price, builder) > 0
  );
}

function strokeLine(
  builder: SkPathBuilder,
  output: number,
  id: string,
  ui: UiIndicatorSeries,
  ctx: IndicatorFrameContext,
  price: PriceScaleSnapshot
): boolean {
  'worklet';
  const values = ui.outputs[output];
  if (values === undefined) {
    return false;
  }
  const { range, time, group, cache } = ctx;
  const { startIndex, endIndex } = range;
  if (group <= 1) {
    return (
      buildLineGeometry(
        values,
        ui.length,
        startIndex,
        endIndex,
        time,
        price,
        builder
      ) > 1
    );
  }
  // Conflated: the min/max envelope polyline (≤ 2 points per bucket).
  const env = cache.values;
  conflateOutput(
    cache,
    ctx.set,
    id,
    ui,
    output,
    startIndex,
    endIndex,
    time,
    group,
    env
  );
  return buildEnvelopeLine(env, price, builder) > 1;
}

/**
 * Records the band fills (first pass) and strokes (second pass) of
 * `items` on `price`'s scale: one path per series, refilled from the
 * shared `builder` and `detach()`ed. At extreme zoom-out (`ctx.group > 1`)
 * each series is drawn from its per-bucket min/max envelope instead of
 * every bar. Worklet (UI thread, per frame).
 */
export function recordIndicatorItems(
  canvas: SkCanvas,
  builder: SkPathBuilder,
  items: readonly IndicatorDrawItem[],
  ctx: IndicatorFrameContext,
  price: PriceScaleSnapshot
): void {
  'worklet';
  // Two passes: every band fill below every line.
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < items.length; n++) {
      const item = items[n] as IndicatorDrawItem;
      const ui = ctx.set.series[item.id];
      if (ui === undefined || !isSeriesAligned(ui, ctx.data)) {
        continue;
      }
      const count = pass === 0 ? item.fills.length : item.strokes.length;
      for (let k = 0; k < count; k++) {
        builder.reset();
        let drawn: boolean;
        let paint: SkPaint;
        if (pass === 0) {
          const fill = item.fills[k] as IndicatorDrawItem['fills'][number];
          paint = fill.paint;
          drawn = fillBand(builder, fill, item.id, ui, ctx, price);
        } else {
          const stroke = item.strokes[
            k
          ] as IndicatorDrawItem['strokes'][number];
          paint = stroke.paint;
          drawn = strokeLine(builder, stroke.output, item.id, ui, ctx, price);
        }
        const path = builder.detach();
        if (drawn) {
          canvas.drawPath(path, paint);
        }
      }
    }
  }
}
