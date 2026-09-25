import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import type { TimeScaleState } from '../../viewport/TimeScale';
import {
  createRectList,
  pushRect,
  type CandleGeometryBatch,
} from '../RenderModel';
import {
  buildCandleGeometry,
  type CandleGeometrySink,
  type CandleMetrics,
  type CandleSeriesView,
} from './CandleGeometry';

/**
 * Collects the streamed candle geometry into a reusable
 * `CandleGeometryBatch` (render-model form). Used by tests, alternative
 * renderers and later picture caches; the per-frame Skia path streams
 * straight into path builders instead.
 */
export function createCandleGeometryBatch(capacity = 0): CandleGeometryBatch {
  return {
    mode: 'candles',
    bullBodies: createRectList(capacity),
    bearBodies: createRectList(capacity),
    bullWicks: createRectList(capacity),
    bearWicks: createRectList(capacity),
    skipped: 0,
  };
}

/** Sink appending to `batch` (does not clear it). */
export function batchSink(batch: CandleGeometryBatch): CandleGeometrySink {
  return {
    body(bullish, x, y, w, h) {
      pushRect(bullish ? batch.bullBodies : batch.bearBodies, x, y, w, h);
    },
    wick(bullish, x, y, w, h) {
      pushRect(bullish ? batch.bullWicks : batch.bearWicks, x, y, w, h);
    },
  };
}

/**
 * Rebuilds `batch` in place for bars `[start, end]`. Storage is kept and
 * only grows, so repeated calls do not allocate once warmed up.
 */
export function fillCandleGeometryBatch(
  batch: CandleGeometryBatch,
  series: CandleSeriesView,
  start: number,
  end: number,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  metrics: CandleMetrics,
  sink: CandleGeometrySink = batchSink(batch)
): CandleGeometryBatch {
  batch.bullBodies.count = 0;
  batch.bearBodies.count = 0;
  batch.bullWicks.count = 0;
  batch.bearWicks.count = 0;
  batch.mode = metrics.wickOnly ? 'wicks' : 'candles';
  const from = start > 0 ? Math.ceil(start) : 0;
  const to = end < series.length - 1 ? Math.floor(end) : series.length - 1;
  const requested =
    to >= from && !Number.isNaN(start) && !Number.isNaN(end)
      ? to - from + 1
      : 0;
  const emitted = buildCandleGeometry(
    series,
    start,
    end,
    time,
    price,
    metrics,
    sink
  );
  batch.skipped = requested - emitted;
  return batch;
}
