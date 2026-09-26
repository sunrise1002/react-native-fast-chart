import {
  ClipOp,
  Skia,
  type SkCanvas,
  type SkPathBuilder,
  type SkPicture,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { UiCandleSeries } from '../../data/UiCandleSeries';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import {
  isSeriesAligned,
  type UiIndicatorSet,
} from '../../indicators/UiIndicatorSet';
import { priceToY, type PriceScaleSnapshot } from '../../viewport/PriceScale';
import type { TimeScaleState } from '../../viewport/TimeScale';
import {
  getVisibleRange,
  type VisibleRange,
} from '../../viewport/VisibleRange';
import {
  computeCandleMetrics,
  createCandleMetrics,
  type CandleMetrics,
} from '../candles/CandleGeometry';
import { buildHistogramGeometry } from '../indicators/HistogramGeometry';
import { frameTimeScale } from './frameScales';
import { recordIndicatorItems } from './indicatorDrawing';
import type { PaneDrawItem } from './PanePaints';
import type { ChartPaints } from './SkiaResources';
import { RENDER_OVERSCAN_BARS } from './useCandlePaths';
import type { PaneScaleFrame } from './usePaneScales';

export interface PaneLayerStyle {
  paints: ChartPaints;
  bodyRatio: number;
  wickWidth: number;
  pixelRatio: number;
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
  metrics: CandleMetrics;
}

function recordHistograms(
  canvas: SkCanvas,
  res: Resources,
  item: PaneDrawItem,
  set: UiIndicatorSet,
  data: UiCandleSeries,
  range: VisibleRange,
  time: TimeScaleState,
  price: PriceScaleSnapshot
): void {
  'worklet';
  const { buckets, used } = res;
  const rect = { x: 0, y: 0, width: 0, height: 0 };
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
    buildHistogramGeometry(
      values,
      ui.length,
      range.startIndex,
      range.endIndex,
      time,
      price,
      res.metrics,
      hist.mode,
      data,
      sink
    );
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
      metrics: createCandleMetrics(),
    };
    return {
      res,
      underlay,
      panes: Skia.PictureRecorder(),
      empty: underlay.finishRecordingAsPicture(),
    };
  }, []);
  const { series, indicators, barSpacing, rightOffset, plotWidth } = state;
  const { paints, bodyRatio, wickWidth, pixelRatio } = style;

  return useDerivedValue<PaneLayerFrame>(() => {
    const data = series.value;
    const frameScales = scales.value.scales;
    if (items.length === 0 || data.length === 0) {
      return { underlay: resources.empty, panes: resources.empty };
    }
    const set = indicators.value;
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      data.length
    );
    const range = getVisibleRange(time, RENDER_OVERSCAN_BARS);
    const { res } = resources;
    computeCandleMetrics(
      time.barSpacing,
      bodyRatio,
      wickWidth,
      pixelRatio,
      res.metrics
    );
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
        recordHistograms(canvas, res, item, set, data, range, time, price);
        recordIndicatorItems(
          canvas,
          res.builder,
          item.list.items,
          set,
          data,
          range,
          time,
          price
        );
        canvas.restore();
      }
      return recorder.finishRecordingAsPicture();
    };
    return { underlay: record(true), panes: record(false) };
  });
}
