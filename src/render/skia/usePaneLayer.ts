import {
  ClipOp,
  Skia,
  type SkCanvas,
  type SkPathBuilder,
  type SkPicture,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import { isSeriesAligned } from '../../indicators/UiIndicatorSet';
import { priceToY, type PriceScaleSnapshot } from '../../viewport/PriceScale';
import { getVisibleRange } from '../../viewport/VisibleRange';
import {
  computeCandleMetrics,
  type CandleMetrics,
} from '../candles/CandleGeometry';
import {
  conflateOutput,
  conflateVisibleCandles,
  frameGroupSize,
  type ConflationStyle,
} from '../conflation/ConflatedLayers';
import { buildHistogramGeometry } from '../indicators/HistogramGeometry';
import { frameTimeScale } from './frameScales';
import {
  recordIndicatorItems,
  type IndicatorFrameContext,
} from './indicatorDrawing';
import type { PaneDrawItem } from './PanePaints';
import type { ChartPaints } from './SkiaResources';
import { RENDER_OVERSCAN_BARS } from './useCandlePaths';
import type { PaneScaleFrame } from './usePaneScales';

export interface PaneLayerStyle extends ConflationStyle {
  paints: ChartPaints;
  bodyRatio: number;
}

/** Pane pictures of one frame. */
export interface PaneLayerFrame {
  /** Price-pane overlays with their own scale (volume), below the candles. */
  underlay: SkPicture;
  /** Indicator panes, each clipped to its rect. */
  panes: SkPicture;
}

/** Up to 4 histogram buckets (`'trend'`). */
const MAX_BUCKETS = 4;

interface Resources {
  builder: SkPathBuilder;
  buckets: SkPathBuilder[];
  used: boolean[];
}

function recordHistograms(
  canvas: SkCanvas,
  res: Resources,
  item: PaneDrawItem,
  ctx: IndicatorFrameContext,
  metrics: CandleMetrics,
  price: PriceScaleSnapshot
): void {
  'worklet';
  const { buckets, used } = res;
  const { set, data, range, time, group, cache } = ctx;
  const rect = cache.frame.rect;
  const sink = {
    bar(bucket: number, x: number, y: number, w: number, h: number) {
      rect.x = x;
      rect.y = y;
      rect.width = w;
      rect.height = h;
      (buckets[bucket] as SkPathBuilder).addRect(rect);
      used[bucket] = true;
    },
  };
  for (let h = 0; h < item.histograms.length; h++) {
    const hist = item.histograms[h] as PaneDrawItem['histograms'][number];
    const ui = set.series[hist.id];
    const values = ui?.outputs[hist.output];
    if (
      ui === undefined ||
      values === undefined ||
      !isSeriesAligned(ui, data)
    ) {
      continue;
    }
    for (let b = 0; b < MAX_BUCKETS; b++) {
      (buckets[b] as SkPathBuilder).reset();
      used[b] = false;
    }
    if (group <= 1) {
      buildHistogramGeometry(
        values,
        ui.length,
        range.startIndex,
        range.endIndex,
        time,
        price,
        metrics,
        hist.mode,
        data,
        sink
      );
    } else {
      // Conflated: one bar per bucket at the group's peak value, colored
      // from the conflated candles (`'candle'`) or the peaks.
      const env = cache.values;
      const n = conflateOutput(
        cache,
        set,
        hist.id,
        ui,
        hist.output,
        range.startIndex,
        range.endIndex,
        time,
        group,
        env
      );
      const candles =
        hist.mode === 'candle'
          ? conflateVisibleCandles(
              cache,
              data,
              range.startIndex,
              range.endIndex,
              time,
              group
            )
          : null;
      buildHistogramGeometry(
        env.peak,
        n,
        0,
        n - 1,
        env.scale,
        price,
        metrics,
        hist.mode,
        candles,
        sink
      );
    }
    for (let b = 0; b < MAX_BUCKETS; b++) {
      const path = (buckets[b] as SkPathBuilder).detach();
      const paint = hist.paints[b];
      if (used[b] && paint !== undefined) {
        canvas.drawPath(path, paint);
      }
    }
  }
}

function recordGuides(
  canvas: SkCanvas,
  item: PaneDrawItem,
  width: number,
  price: PriceScaleSnapshot,
  paints: ChartPaints
): void {
  'worklet';
  const band = item.guideBand;
  if (band !== null) {
    const a = priceToY(price, band.upper);
    const b = priceToY(price, band.lower);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const top = a < b ? a : b;
      canvas.drawRect(
        { x: 0, y: top, width, height: Math.abs(b - a) },
        paints.guideBand
      );
    }
  }
  for (let g = 0; g < item.guideLevels.length; g++) {
    const y = priceToY(price, item.guideLevels[g] as number);
    if (Number.isFinite(y)) {
      canvas.drawLine(0, y, width, y, paints.guideLine);
    }
  }
}

/**
 * Records the indicator panes (spec §12, §17.4) on the UI thread: per
 * pane item, clipped to its rect — guide band and levels, histograms
 * (one path per color bucket), band fills, then lines. Price-pane
 * overlays (volume) go to a separate picture drawn below the candles.
 * Two pictures regardless of the number of panes or bars.
 */
export function usePaneLayer(
  state: ChartSharedState,
  items: readonly PaneDrawItem[],
  scales: SharedValue<PaneScaleFrame>,
  style: PaneLayerStyle
): SharedValue<PaneLayerFrame> {
  const resources = useMemo(() => {
    const underlay = Skia.PictureRecorder();
    underlay.beginRecording();
    const res: Resources = {
      builder: Skia.PathBuilder.Make(),
      buckets: Array.from({ length: MAX_BUCKETS }, () =>
        Skia.PathBuilder.Make()
      ),
      used: new Array<boolean>(MAX_BUCKETS).fill(false),
    };
    return {
      res,
      underlay,
      panes: Skia.PictureRecorder(),
      empty: underlay.finishRecordingAsPicture(),
    };
  }, []);
  const { series, indicators, barSpacing, rightOffset, plotWidth } = state;
  const { renderCache } = state;
  const { paints, bodyRatio, wickWidth, pixelRatio, conflationPx } = style;

  return useDerivedValue<PaneLayerFrame>(() => {
    const data = series.value;
    const frameScales = scales.value.scales;
    if (items.length === 0 || data.length === 0) {
      return { underlay: resources.empty, panes: resources.empty };
    }
    const set = indicators.value;
    const cache = renderCache.value;
    const scratch = cache.frame;
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      data.length,
      scratch.time
    );
    const range = getVisibleRange(time, RENDER_OVERSCAN_BARS, scratch.range);
    const group = frameGroupSize(
      time.barSpacing,
      conflationPx,
      wickWidth,
      pixelRatio
    );
    const metrics = computeCandleMetrics(
      time.barSpacing * group,
      bodyRatio,
      wickWidth,
      pixelRatio,
      scratch.metrics
    );
    const ctx: IndicatorFrameContext = { set, data, range, time, group, cache };
    const { res } = resources;
    const record = (overlay: boolean): SkPicture => {
      const recorder = overlay ? resources.underlay : resources.panes;
      const canvas = recorder.beginRecording();
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as PaneDrawItem;
        const price = frameScales[i];
        if (
          item.overlay !== overlay ||
          price === undefined ||
          !(price.height > 0) ||
          !Number.isFinite(price.min)
        ) {
          continue;
        }
        canvas.save();
        canvas.clipRect(
          { x: 0, y: price.top, width: time.width, height: price.height },
          ClipOp.Intersect,
          true
        );
        recordGuides(canvas, item, time.width, price, paints);
        recordHistograms(canvas, res, item, ctx, metrics, price);
        recordIndicatorItems(canvas, res.builder, item.list.items, ctx, price);
        canvas.restore();
      }
      return recorder.finishRecordingAsPicture();
    };
    return { underlay: record(true), panes: record(false) };
  });
}
