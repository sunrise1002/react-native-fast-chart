import type { UiCandleSeries } from '../data/UiCandleSeries';
import type { IndicatorUpdate } from './IndicatorCompute';

/*
 * UI-thread copy of the indicator outputs (same approach as
 * `UiCandleSeries`): worklets cannot read the JS-thread result columns, so
 * each flush ships either a full snapshot (recalculation) or the changed
 * tail (realtime tick, O(changed bars)) in one packed `Float64Array`.
 * Pure TypeScript, no Reanimated import (glue lives in `engine/`).
 */

export interface UiIndicatorSeries {
  /** One column per output; slots at `index >= length` hold `NaN`. */
  outputs: Float64Array[];
  length: number;
  /** Candle dataset the values belong to (see `isSeriesAligned`). */
  resetVersion: number;
  firstTime: number;
}

export interface UiIndicatorSet {
  series: Record<string, UiIndicatorSeries>;
  /** Incremented by every applied payload. */
  revision: number;
}

/** JS → UI transfer of one indicator update. */
export interface IndicatorPayload {
  id: string;
  removed: boolean;
  /** Replace the series (`true`) or write `values` from bar `from`. */
  full: boolean;
  from: number;
  /** Series length after the update. */
  length: number;
  outputs: number;
  resetVersion: number;
  firstTime: number;
  /** Output-major: `outputs` runs of `length - from` values. */
  values: Float64Array;
}

/** Tail updates up to this many bars are patched in place. */
export const MAX_INDICATOR_PATCH_BARS = 512;
/** Spare slots allocated after the last bar of a snapshot. */
export const UI_INDICATOR_HEADROOM = 256;

export function emptyUiIndicatorSet(): UiIndicatorSet {
  return { series: {}, revision: 0 };
}

/** Packs an engine update for the UI thread (JS thread). */
export function packIndicatorUpdate(update: IndicatorUpdate): IndicatorPayload {
  if (update.removed) {
    return {
      id: update.id,
      removed: true,
      full: false,
      from: 0,
      length: 0,
      outputs: 0,
      resetVersion: 0,
      firstTime: NaN,
      values: new Float64Array(0),
    };
  }
  const { result } = update;
  const length = result.length;
  const tail = length - update.from;
  const full = update.full || !(tail >= 0) || tail > MAX_INDICATOR_PATCH_BARS;
  const from = full ? 0 : update.from;
  const count = length - from;
  const outputs = result.outputs.length;
  const values = new Float64Array(count * outputs);
  for (let k = 0; k < outputs; k++) {
    values.set(
      (result.outputs[k] as Float64Array).subarray(from, length),
      k * count
    );
  }
  return {
    id: update.id,
    removed: false,
    full,
    from,
    length,
    outputs,
    resetVersion: update.resetVersion,
    firstTime: update.firstTime,
    values,
  };
}

function nanFilled(capacity: number): Float64Array {
  'worklet';
  const column = new Float64Array(capacity);
  column.fill(NaN);
  return column;
}

function writeValues(
  series: UiIndicatorSeries,
  payload: IndicatorPayload
): void {
  'worklet';
  const { from, length, values } = payload;
  const count = length - from;
  const capacity =
    series.outputs.length > 0 ? (series.outputs[0] as Float64Array).length : 0;
  const grow = length > capacity;
  for (let k = 0; k < series.outputs.length; k++) {
    let column = series.outputs[k] as Float64Array;
    if (grow) {
      const next = nanFilled(Math.max(length + 16, capacity * 2));
      next.set(column.subarray(0, series.length));
      column = next;
      series.outputs[k] = next;
    }
    column.set(values.subarray(k * count, (k + 1) * count), from);
    if (series.length > length) {
      column.fill(NaN, length, series.length);
    }
  }
  series.length = length;
}

/**
 * Applies payloads in order (worklet). Tail payloads for unknown series or
 * with a mismatching shape are ignored (a full snapshot always precedes
 * them).
 */
export function applyIndicatorPayloads(
  set: UiIndicatorSet,
  payloads: readonly IndicatorPayload[]
): void {
  'worklet';
  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i] as IndicatorPayload;
    const { id } = payload;
    if (payload.removed) {
      delete set.series[id];
      continue;
    }
    if (payload.full) {
      const outputs: Float64Array[] = [];
      for (let k = 0; k < payload.outputs; k++) {
        outputs.push(nanFilled(payload.length + UI_INDICATOR_HEADROOM));
      }
      const series: UiIndicatorSeries = {
        outputs,
        length: 0,
        resetVersion: payload.resetVersion,
        firstTime: payload.firstTime,
      };
      writeValues(series, payload);
      set.series[id] = series;
      continue;
    }
    const series = set.series[id];
    if (
      series === undefined ||
      series.outputs.length !== payload.outputs ||
      payload.from > series.length
    ) {
      continue;
    }
    writeValues(series, payload);
  }
  set.revision++;
}

/**
 * `true` when `series` was computed from the dataset currently shown by
 * `candles` (same reset generation and first bar). Indicator results reach
 * the UI up to a frame after the candles; after a reset / prepend the
 * stale values would be misaligned, so renderers skip them until then.
 */
export function isSeriesAligned(
  series: UiIndicatorSeries,
  candles: UiCandleSeries
): boolean {
  'worklet';
  return (
    candles.length > 0 &&
    series.resetVersion === candles.resetVersion &&
    series.firstTime === candles.time[0]
  );
}

/** `(id, output)` of an overlay value column (auto-scale input). */
export interface UiOutputRef {
  id: string;
  output: number;
}

/**
 * Widens `out` (a valid min/max) by the finite values of the referenced
 * aligned outputs over bars `[start, end]` (inclusive). Worklet,
 * allocation-free.
 */
export function extendRangeWithOutputs(
  set: UiIndicatorSet,
  candles: UiCandleSeries,
  refs: readonly UiOutputRef[],
  start: number,
  end: number,
  out: { min: number; max: number }
): void {
  'worklet';
  for (let r = 0; r < refs.length; r++) {
    const ref = refs[r] as UiOutputRef;
    const series = set.series[ref.id];
    const column = series?.outputs[ref.output];
    if (!series || !column || !isSeriesAligned(series, candles)) {
      continue;
    }
    const from = start > 0 ? Math.ceil(start) : 0;
    const to = end < series.length - 1 ? Math.floor(end) : series.length - 1;
    for (let i = from; i <= to; i++) {
      const v = column[i] as number;
      if (v - v !== 0) {
        continue;
      }
      if (v < out.min) {
        out.min = v;
      }
      if (v > out.max) {
        out.max = v;
      }
    }
  }
}
