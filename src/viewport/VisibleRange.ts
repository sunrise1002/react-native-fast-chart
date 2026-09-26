import type { LogicalRange } from '../core/ChartTypes';
import {
  rightEdgeIndex,
  visibleBarCount,
  type TimeScaleState,
} from './TimeScale';

/**
 * Whole-bar index range to render, **inclusive** on both ends. Empty when
 * `endIndex < startIndex` (canonical empty value: `{0, -1}`).
 */
export interface VisibleRange {
  startIndex: number;
  endIndex: number;
}

/** Default bars rendered beyond each edge (spec §10.3: 10–30). */
export const DEFAULT_OVERSCAN_BARS = 20;

/**
 * Fractional logical range covered by the plot, `[left edge, right edge]`.
 * Writes into `out` when given (allocation-free).
 */
export function getVisibleLogicalRange(
  state: TimeScaleState,
  out: LogicalRange = { from: 0, to: 0 }
): LogicalRange {
  'worklet';
  const to = rightEdgeIndex(state);
  out.from = to - visibleBarCount(state);
  out.to = to;
  return out;
}

/**
 * Bars whose slot intersects the plot, extended by `overscan` bars on each
 * side (to avoid popping during fast gestures) and clamped to
 * `[0, barCount - 1]`. Never includes every stored bar unless they all fit.
 * Non-finite state yields the empty range. Writes into `out` when given.
 */
export function getVisibleRange(
  state: TimeScaleState,
  overscan: number = DEFAULT_OVERSCAN_BARS,
  out: VisibleRange = { startIndex: 0, endIndex: -1 }
): VisibleRange {
  'worklet';
  const right = rightEdgeIndex(state);
  const left = right - visibleBarCount(state);
  const pad = overscan > 0 ? Math.floor(overscan) : 0;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    !(state.barSpacing > 0) ||
    state.barCount <= 0
  ) {
    out.startIndex = 0;
    out.endIndex = -1;
    return out;
  }
  // Bar i occupies [i - 0.5, i + 0.5]; it is visible when that slot
  // overlaps (left, right).
  const first = Math.floor(left + 0.5) - pad;
  const last = Math.ceil(right + 0.5) - 1 + pad;
  const start = first > 0 ? first : 0;
  const end = last < state.barCount - 1 ? last : state.barCount - 1;
  if (end < start) {
    out.startIndex = 0;
    out.endIndex = -1;
  } else {
    out.startIndex = start;
    out.endIndex = end;
  }
  return out;
}

/**
 * Logical bar indices at the plot edges (no overscan, **not** clamped to
 * the stored bars): `endIndex` may exceed `barCount − 1` when the view
 * shows the empty area right of the last bar, which shifted series
 * (Ichimoku leading spans) draw into. Empty for a non-finite state.
 */
export function getViewIndexRange(
  state: TimeScaleState,
  out: VisibleRange = { startIndex: 0, endIndex: -1 }
): VisibleRange {
  'worklet';
  const right = rightEdgeIndex(state);
  const left = right - visibleBarCount(state);
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    !(state.barSpacing > 0)
  ) {
    out.startIndex = 0;
    out.endIndex = -1;
    return out;
  }
  out.startIndex = Math.floor(left + 0.5);
  out.endIndex = Math.ceil(right + 0.5) - 1;
  return out;
}
