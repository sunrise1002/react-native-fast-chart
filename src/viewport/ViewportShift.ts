import {
  rightEdgeIndex,
  visibleBarCount,
  type TimeScaleState,
} from './TimeScale';

/*
 * Viewport bookkeeping for data changes at either end of the series
 * (spec Phase 15.4 follow-realtime, Phase 16 history pagination). Pure
 * worklets over numbers.
 *
 * The X model is anchored at the right edge (`TimeScale`): logical bar
 * `i` sits at `x = width - (barCount - 0.5 + rightOffset - i) * spacing`.
 *
 * - Prepending `k` bars renumbers every bar `i → i + k` and grows
 *   `barCount` by `k`; both terms cancel, so with `rightOffset` unchanged
 *   every existing bar keeps its exact pixel position. Only stored
 *   *indices* (crosshair bar, cached ranges) must be shifted by `k`.
 * - Appending `k` bars grows `barCount` only, which scrolls the content
 *   left by `k` bars ("follow"). Subtracting `k` from `rightOffset`
 *   cancels it ("hold still").
 */

/**
 * `rightOffset` delta after `appended` bars were added to a series of
 * `previousLength` bars. `lastBarWasVisible` is the state *before* the
 * append. Follows (0) when enabled and the user was at the right edge;
 * otherwise holds the view still (`-appended`). Nothing to hold for the
 * very first bars or invalid counts.
 */
export function appendOffsetShift(
  appended: number,
  previousLength: number,
  lastBarWasVisible: boolean,
  followRealtime: boolean
): number {
  'worklet';
  if (!(appended > 0) || !(previousLength > 0) || appended === Infinity) {
    return 0;
  }
  return followRealtime && lastBarWasVisible ? 0 : -appended;
}

/**
 * Index of the same bar after `count` bars were prepended. Negative
 * indices (`-1` = none) and invalid counts are returned unchanged.
 */
export function shiftIndexForPrepend(index: number, count: number): number {
  'worklet';
  if (!(index >= 0) || !(count > 0) || count === Infinity) {
    return index;
  }
  return index + count;
}

/**
 * Bars between the oldest loaded bar and the view's left edge (negative
 * when the view shows empty space left of bar 0). `NaN` for a degenerate
 * scale or an empty series.
 */
export function barsBeforeView(state: TimeScaleState): number {
  'worklet';
  if (!(state.barCount > 0) || !(state.barSpacing > 0) || !(state.width > 0)) {
    return NaN;
  }
  // Bar 0 occupies [-0.5, 0.5]; the left edge sits at `right - visible`.
  const left = rightEdgeIndex(state) - visibleBarCount(state);
  return Number.isFinite(left) ? left + 0.5 : NaN;
}

/**
 * `true` when older history should be requested: the left edge is within
 * `thresholdBars` of the oldest bar (spec §23.2). Never for an empty
 * series or a degenerate scale.
 */
export function isNearHistoryStart(
  state: TimeScaleState,
  thresholdBars: number
): boolean {
  'worklet';
  const before = barsBeforeView(state);
  const threshold = thresholdBars > 0 ? thresholdBars : 0;
  return before <= threshold;
}
