import type { PriceRange } from '../../core/ChartTypes';
import {
  createMinMaxPyramid,
  pyramidRangeMinMax,
  syncPyramid,
  type MinMaxPyramid,
} from '../../data/MinMaxPyramid';
import type { UiCandleSeries } from '../../data/UiCandleSeries';
import {
  extendRangeWithColumn,
  isSeriesAligned,
  MAX_INDICATOR_PATCH_BARS,
  type UiIndicatorSeries,
  type UiIndicatorSet,
  type UiOutputRef,
} from '../../indicators/UiIndicatorSet';
import { candleRangeMinMax } from '../../viewport/AutoScale';
import type { TimeScaleState } from '../../viewport/TimeScale';
import type { VisibleRange } from '../../viewport/VisibleRange';
import {
  createCandleMetrics,
  type CandleMetrics,
} from '../candles/CandleGeometry';
import {
  createConflatedCandles,
  createConflatedValues,
  type ConflatedCandles,
  type ConflatedValues,
} from './Conflation';

/*
 * UI-thread render cache (P8): min/max pyramids of the displayed candles
 * and indicator outputs plus reusable conflation scratch. It lives in a
 * shared value (`ChartSharedState.renderCache`) that is mutated in place
 * on the UI thread and never reassigned, so reading it in a mapper does
 * not make the mapper re-run. Pyramids are built lazily — only when a
 * frame conflates or queries a long range — and kept up to date
 * incrementally:
 *
 * - candles: a new series object (snapshot: reset / prepend / big patch)
 *   rebuilds; an in-place write (`revision` changed) re-syncs the tail.
 *   In-place writes are always tail batches ending at the current length
 *   (`StoreSync`), so the lowest changed bar is at least
 *   `builtLength − Δrevision` (one revision per written bar);
 * - indicator outputs: a new series object rebuilds; a changed
 *   `UiIndicatorSet.revision` re-syncs the last `MAX_INDICATOR_PATCH_BARS`
 *   bars (the largest in-place tail payload).
 *
 * Pure TypeScript (no Reanimated import), worklet-compatible.
 */

/** Ranges shorter than this are scanned linearly (cheaper than a pyramid). */
export const PYRAMID_QUERY_MIN_BARS = 2048;

interface OutputPyramid {
  series: UiIndicatorSeries;
  setRevision: number;
  pyramid: MinMaxPyramid;
}

export interface RenderCache {
  candleSource: UiCandleSeries | null;
  candleRevision: number;
  candlePyramid: MinMaxPyramid;
  /** Output pyramids by indicator id, then output index. */
  outputs: Record<string, (OutputPyramid | undefined)[]>;
  /** Scratch: conflated candles of the current mapper. */
  candles: ConflatedCandles;
  /** Scratch: conflated values (line / upper band edge / histogram). */
  values: ConflatedValues;
  /** Scratch: conflated lower band edge. */
  lower: ConflatedValues;
  /** Scratch: min/max out-parameter. */
  extremes: PriceRange;
  /**
   * Per-frame scratch shared by the mappers (allocation audit, P8). A
   * mapper fills and consumes it within one run; mappers never nest and
   * never return these objects.
   */
  frame: FrameScratch;
}

/** Mutable per-frame objects reused instead of allocating each frame. */
export interface FrameScratch {
  time: TimeScaleState;
  price: MutablePriceScale;
  range: VisibleRange;
  /** Unclamped view edges (`getViewIndexRange`). */
  view: VisibleRange;
  /** Time scale / range of a shifted series (`IndicatorEntry.offsets`). */
  shiftedTime: TimeScaleState;
  shiftedRange: VisibleRange;
  metrics: CandleMetrics;
  /** Candle metrics at the conflated bucket width. */
  bucketMetrics: CandleMetrics;
  rect: { x: number; y: number; width: number; height: number };
}

/** A `PriceScaleSnapshot` that can be refilled in place. */
export interface MutablePriceScale {
  mode: 'linear';
  top: number;
  height: number;
  min: number;
  max: number;
}

export function createFrameScratch(): FrameScratch {
  'worklet';
  return {
    time: { width: 0, barSpacing: 0, rightOffset: 0, barCount: 0 },
    price: { mode: 'linear', top: 0, height: 0, min: NaN, max: NaN },
    range: { startIndex: 0, endIndex: -1 },
    view: { startIndex: 0, endIndex: -1 },
    shiftedTime: { width: 0, barSpacing: 0, rightOffset: 0, barCount: 0 },
    shiftedRange: { startIndex: 0, endIndex: -1 },
    metrics: createCandleMetrics(),
    bucketMetrics: createCandleMetrics(),
    rect: { x: 0, y: 0, width: 0, height: 0 },
  };
}

export function createRenderCache(): RenderCache {
  'worklet';
  return {
    candleSource: null,
    candleRevision: 0,
    candlePyramid: createMinMaxPyramid(),
    outputs: {},
    candles: createConflatedCandles(),
    values: createConflatedValues(),
    lower: createConflatedValues(),
    extremes: { min: NaN, max: NaN },
    frame: createFrameScratch(),
  };
}

/** High/low pyramid of `data`, synced (O(1) when nothing changed). */
export function candlePyramid(
  cache: RenderCache,
  data: UiCandleSeries
): MinMaxPyramid {
  'worklet';
  const pyramid = cache.candlePyramid;
  if (cache.candleSource !== data) {
    syncPyramid(pyramid, data.low, data.high, 0, data.length, 0);
  } else if (
    cache.candleRevision !== data.revision ||
    pyramid.length !== data.length
  ) {
    const built = Math.min(pyramid.length, data.length);
    const delta = data.revision - cache.candleRevision;
    const from = delta >= 0 && delta < built ? built - delta : 0;
    syncPyramid(pyramid, data.low, data.high, 0, data.length, from);
  }
  cache.candleSource = data;
  cache.candleRevision = data.revision;
  return pyramid;
}

/** Pyramid of output `output` of `series` (id `id`), synced. */
export function outputPyramid(
  cache: RenderCache,
  set: UiIndicatorSet,
  id: string,
  series: UiIndicatorSeries,
  output: number
): MinMaxPyramid | undefined {
  'worklet';
  const column = series.outputs[output];
  if (column === undefined) {
    return undefined;
  }
  let slots = cache.outputs[id];
  if (slots === undefined) {
    slots = [];
    cache.outputs[id] = slots;
  }
  let entry = slots[output];
  if (entry === undefined) {
    entry = { series, setRevision: NaN, pyramid: createMinMaxPyramid() };
    slots[output] = entry;
    syncPyramid(entry.pyramid, column, column, 0, series.length, 0);
  } else if (entry.series !== series) {
    syncPyramid(entry.pyramid, column, column, 0, series.length, 0);
  } else if (
    entry.setRevision !== set.revision ||
    entry.pyramid.length !== series.length
  ) {
    const built = Math.min(entry.pyramid.length, series.length);
    const from = built - MAX_INDICATOR_PATCH_BARS;
    syncPyramid(
      entry.pyramid,
      column,
      column,
      0,
      series.length,
      from > 0 ? from : 0
    );
  }
  entry.series = series;
  entry.setRevision = set.revision;
  return entry.pyramid;
}

/** Drops the pyramids of indicators no longer in `set`. */
export function pruneOutputPyramids(
  cache: RenderCache,
  set: UiIndicatorSet
): void {
  'worklet';
  for (const id in cache.outputs) {
    if (set.series[id] === undefined) {
      delete cache.outputs[id];
    }
  }
}

/**
 * `candleRangeMinMax` for bars `[start, end]`: a linear scan for short
 * ranges, the pyramid (O(log n)) for long ones (extreme zoom-out).
 */
export function cachedCandleRange(
  cache: RenderCache,
  data: UiCandleSeries,
  start: number,
  end: number,
  out: PriceRange
): boolean {
  'worklet';
  if (!(end - start + 1 >= PYRAMID_QUERY_MIN_BARS)) {
    return candleRangeMinMax(data, start, end, out);
  }
  out.min = NaN;
  out.max = NaN;
  const pyramid = candlePyramid(cache, data);
  // Leaves `out` NaN (the `candleRangeMinMax` empty result) when empty.
  return pyramidRangeMinMax(pyramid, data.low, data.high, 0, start, end, out);
}

/**
 * `extendRangeWithOutputs` with the same pyramid switch as
 * `cachedCandleRange` (per aligned output). Shifted refs cover the view
 * edges `[left, right]` (default `[start, end]`).
 */
export function cachedExtendRange(
  cache: RenderCache,
  set: UiIndicatorSet,
  data: UiCandleSeries,
  refs: readonly UiOutputRef[],
  start: number,
  end: number,
  out: PriceRange,
  left: number = start,
  right: number = end
): void {
  'worklet';
  const long = end - start + 1 >= PYRAMID_QUERY_MIN_BARS;
  for (let r = 0; r < refs.length; r++) {
    const ref = refs[r] as UiOutputRef;
    const series = set.series[ref.id];
    const column = series?.outputs[ref.output];
    if (!series || !column || !isSeriesAligned(series, data)) {
      continue;
    }
    const offset = ref.offset ?? 0;
    const from = offset === 0 ? start : left - offset;
    const to = offset === 0 ? end : right - offset;
    const pyramid = long
      ? outputPyramid(cache, set, ref.id, series, ref.output)
      : undefined;
    if (pyramid === undefined) {
      extendRangeWithColumn(column, series.length, from, to, out);
    } else {
      pyramidRangeMinMax(pyramid, column, column, 0, from, to, out);
    }
  }
}
