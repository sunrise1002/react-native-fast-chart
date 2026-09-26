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
import {
  getVisibleRange,
  type VisibleRange,
} from '../../viewport/VisibleRange';
import { conflateOutput } from '../conflation/ConflatedLayers';
import type { RenderCache } from '../conflation/RenderCache';
import { buildEnvelopeLine } from '../conflation/ValueConflation';
import { buildCloudFill } from '../indicators/CloudGeometry';
import {
  buildBandFill,
  buildLineGeometry,
  buildPointGeometry,
} from '../indicators/LineGeometry';
import type { IndicatorDrawItem } from './IndicatorPaints';
import { RENDER_OVERSCAN_BARS } from './useCandlePaths';

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

type FillItem = IndicatorDrawItem['fills'][number];
type StrokeItem = IndicatorDrawItem['strokes'][number];

/**
 * Time scale of a series drawn `offset` bars right of its bar: value `i`
 * at bar `i + offset` is value `i` on a scale with `rightOffset − offset`,
 * so the regular geometry builders (and conflation) apply unchanged and
 * leading values extend into the right padding. Reuses the cache scratch.
 */
function seriesTime(
  ctx: IndicatorFrameContext,
  offset: number
): TimeScaleState {
  'worklet';
  if (offset === 0) {
    return ctx.time;
  }
  const time = ctx.cache.frame.shiftedTime;
  time.width = ctx.time.width;
  time.barSpacing = ctx.time.barSpacing;
  time.rightOffset = ctx.time.rightOffset - offset;
  time.barCount = ctx.time.barCount;
  return time;
}

/** Drawn bar range of a series on its (shifted) `time` scale. */
function seriesRange(
  ctx: IndicatorFrameContext,
  time: TimeScaleState,
  offset: number
): VisibleRange {
  'worklet';
  return offset === 0
    ? ctx.range
    : getVisibleRange(time, RENDER_OVERSCAN_BARS, ctx.cache.frame.shiftedRange);
}

/**
 * Band between two outputs: plain (`sign = 0`) or the `sign` side of a
 * cloud (`+1`: upper ≥ lower, `−1`: upper < lower).
 */
function fillBand(
  builder: SkPathBuilder,
  fill: FillItem,
  sign: number,
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
  const { group, cache } = ctx;
  const time = seriesTime(ctx, fill.offset);
  const { startIndex, endIndex } = seriesRange(ctx, time, fill.offset);
  if (group <= 1) {
    const len = ui.length;
    const polygons =
      sign === 0
        ? buildBandFill(
            upper,
            lower,
            len,
            startIndex,
            endIndex,
            time,
            price,
            builder
          )
        : buildCloudFill(
            upper,
            lower,
            len,
            startIndex,
            endIndex,
            time,
            price,
            sign,
            builder
          );
    return polygons > 0;
  }
  // Conflated: the band's outer envelope (max of upper, min of lower); a
  // cloud uses the last value per bucket so the sides stay exclusive.
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
  const last = n - 1;
  return (
    (sign === 0
      ? buildBandFill(hi.max, lo.min, n, 0, last, hi.scale, price, builder)
      : buildCloudFill(
          hi.last,
          lo.last,
          n,
          0,
          last,
          hi.scale,
          price,
          sign,
          builder
        )) > 0
  );
}

/** Polyline (`radius = 0`) or one dot per bar of an output. */
function strokeLine(
  builder: SkPathBuilder,
  stroke: StrokeItem,
  id: string,
  ui: UiIndicatorSeries,
  ctx: IndicatorFrameContext,
  price: PriceScaleSnapshot
): boolean {
  'worklet';
  const { output, radius } = stroke;
  const values = ui.outputs[output];
  if (values === undefined) {
    return false;
  }
  const { group, cache } = ctx;
  const time = seriesTime(ctx, stroke.offset);
  const { startIndex, endIndex } = seriesRange(ctx, time, stroke.offset);
  const len = ui.length;
  if (group <= 1) {
    return radius > 0
      ? buildPointGeometry(
          values,
          len,
          startIndex,
          endIndex,
          time,
          price,
          radius,
          builder
        ) > 0
      : buildLineGeometry(
          values,
          len,
          startIndex,
          endIndex,
          time,
          price,
          builder
        ) > 1;
  }
  // Conflated: the min/max envelope polyline (≤ 2 points per bucket), or
  // the last value of each bucket for dots.
  const env = cache.values;
  const n = conflateOutput(
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
  return radius > 0
    ? buildPointGeometry(
        env.last,
        n,
        0,
        n - 1,
        env.scale,
        price,
        radius,
        builder
      ) > 0
    : buildEnvelopeLine(env, price, builder) > 1;
}

/** Detaches the builder's path and draws it when anything was added. */
function flush(
  canvas: SkCanvas,
  builder: SkPathBuilder,
  drawn: boolean,
  paint: SkPaint
): void {
  'worklet';
  const path = builder.detach();
  if (drawn) {
    canvas.drawPath(path, paint);
  }
}

/**
 * Records the band fills (first pass) and strokes (second pass) of
 * `items` on `price`'s scale: one path per series (two for a cloud, one
 * per color), refilled from the shared `builder` and `detach()`ed.
 * Shifted outputs (`offset`) are drawn on a shifted time scale. At extreme
 * zoom-out (`ctx.group > 1`) each series is drawn from its per-bucket
 * envelope instead of every bar. Worklet (UI thread, per frame).
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
      if (pass === 1) {
        for (let k = 0; k < item.strokes.length; k++) {
          const stroke = item.strokes[k] as StrokeItem;
          builder.reset();
          const drawn = strokeLine(builder, stroke, item.id, ui, ctx, price);
          flush(canvas, builder, drawn, stroke.paint);
        }
        continue;
      }
      for (let k = 0; k < item.fills.length; k++) {
        const fill = item.fills[k] as FillItem;
        const cloud = fill.downPaint !== null;
        builder.reset();
        let drawn = fillBand(
          builder,
          fill,
          cloud ? 1 : 0,
          item.id,
          ui,
          ctx,
          price
        );
        flush(canvas, builder, drawn, fill.paint);
        if (fill.downPaint !== null) {
          builder.reset();
          drawn = fillBand(builder, fill, -1, item.id, ui, ctx, price);
          flush(canvas, builder, drawn, fill.downPaint);
        }
      }
    }
  }
}
