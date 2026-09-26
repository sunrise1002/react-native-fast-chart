import type { PriceRange } from '../../core/ChartTypes';
import type { UiCandleSeries } from '../../data/UiCandleSeries';
import type { IndicatorScaleSpec } from '../../indicators/IndicatorRegistry';
import type {
  UiIndicatorSeries,
  UiIndicatorSet,
  UiOutputRef,
} from '../../indicators/UiIndicatorSet';
import { paneRangeFromValues } from '../../panes/PaneScale';
import { padPriceRange } from '../../viewport/AutoScaleTarget';
import type { PriceScaleOptions } from '../../viewport/PriceScale';
import type { TimeScaleState } from '../../viewport/TimeScale';
import { getVisibleRange } from '../../viewport/VisibleRange';
import {
  conflateCandles,
  conflationGroupSize,
  conflationMinSlotPx,
  type ConflatedCandles,
  type ConflatedValues,
} from './Conflation';
import {
  cachedCandleRange,
  cachedExtendRange,
  candlePyramid,
  outputPyramid,
  type RenderCache,
} from './RenderCache';
import { conflateValues } from './ValueConflation';

/*
 * Glue between the render cache and the layers (P8): the frame's
 * conflation group size (identical for every layer, so candles,
 * indicators and panes bucket the same bars) and cache-backed
 * conflation / range queries. Pure TypeScript, worklet-compatible.
 */

/** Inputs of `frameGroupSize` that come from the config / theme. */
export interface ConflationStyle {
  /** Min bucket width, device px (`0` = conflation off). */
  conflationPx: number;
  wickWidth: number;
  pixelRatio: number;
}

/** Conflation disabled (tests, layers without conflation support). */
export const NO_CONFLATION: ConflationStyle = Object.freeze({
  conflationPx: 0,
  wickWidth: 1,
  pixelRatio: 1,
});

/**
 * Bars per bucket for the frame (`1` = no conflation): conflate once a
 * bar slot is narrower than `conflationPx` device px or the wick.
 */
export function frameGroupSize(
  barSpacing: number,
  conflationPx: number,
  wickWidthDp: number,
  pixelRatio: number
): number {
  'worklet';
  return conflationGroupSize(
    barSpacing,
    pixelRatio,
    conflationMinSlotPx(conflationPx, wickWidthDp, pixelRatio)
  );
}

/** Conflates candles `[start, end]` into `cache.candles`. */
export function conflateVisibleCandles(
  cache: RenderCache,
  data: UiCandleSeries,
  start: number,
  end: number,
  time: TimeScaleState,
  group: number
): ConflatedCandles {
  'worklet';
  const pyramid = candlePyramid(cache, data);
  const out = cache.candles;
  conflateCandles(data, pyramid, start, end, time, group, out, cache.extremes);
  return out;
}

/**
 * Conflates output `output` of indicator `id` over bars `[start, end]`
 * into `out` (`cache.values` / `cache.lower`). Returns the bucket count
 * (0 for a missing output).
 */
export function conflateOutput(
  cache: RenderCache,
  set: UiIndicatorSet,
  id: string,
  series: UiIndicatorSeries,
  output: number,
  start: number,
  end: number,
  time: TimeScaleState,
  group: number,
  out: ConflatedValues
): number {
  'worklet';
  const column = series.outputs[output];
  const pyramid = outputPyramid(cache, set, id, series, output);
  if (column === undefined || pyramid === undefined) {
    out.length = 0;
    return 0;
  }
  return conflateValues(
    column,
    series.length,
    pyramid,
    start,
    end,
    time,
    group,
    out,
    cache.extremes
  );
}

/**
 * `computeAutoScaleTarget` backed by the render cache: O(log n) range
 * queries for long visible ranges (extreme zoom-out).
 */
export function cachedAutoScaleTarget(
  cache: RenderCache,
  data: UiCandleSeries,
  set: UiIndicatorSet,
  refs: readonly UiOutputRef[],
  time: TimeScaleState,
  out: PriceRange,
  options: PriceScaleOptions = {}
): boolean {
  'worklet';
  const range = getVisibleRange(time, 0, cache.frame.range);
  const { startIndex, endIndex } = range;
  if (!cachedCandleRange(cache, data, startIndex, endIndex, out)) {
    return false;
  }
  if (refs.length > 0) {
    cachedExtendRange(cache, set, data, refs, startIndex, endIndex, out);
  }
  padPriceRange(out, options);
  return true;
}

/** `computePaneRange` backed by the render cache. */
export function cachedPaneRange(
  cache: RenderCache,
  scale: IndicatorScaleSpec,
  set: UiIndicatorSet,
  data: UiCandleSeries,
  refs: readonly UiOutputRef[],
  start: number,
  end: number,
  out: PriceRange
): boolean {
  'worklet';
  const values = cache.extremes;
  values.min = Infinity;
  values.max = -Infinity;
  if (scale.kind !== 'fixed') {
    cachedExtendRange(cache, set, data, refs, start, end, values);
  }
  return paneRangeFromValues(scale, values, out);
}
