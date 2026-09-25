import { clamp, rubberBand } from './ScaleMath';

/**
 * Horizontal coordinate system (spec §10, Phase 2.1–2.4).
 *
 * Logical index `i` is the center of bar `i`; fractional indices are valid
 * (sub-bar panning, whitespace before the first / after the last bar).
 * The right edge of the plot sits at logical index
 * `R = barCount - 1 + rightOffset + 0.5`, so:
 *
 *   x(i) = width - (R - i) * barSpacing
 *
 * `rightOffset` is the number of empty bar slots between the last bar and
 * the right edge (TradingView's "right offset"): positive = realtime
 * padding, negative = scrolled into history. Anchoring at the right edge
 * means **prepending history never moves the viewport**; appending moves it
 * by one bar, which is exactly "follow realtime". To keep the view still
 * while scrolled back, add the appended count to `rightOffset`.
 *
 * All functions are worklet-compatible (see `ScaleMath.ts`) and take the
 * state as a plain object so they can read a Reanimated shared value
 * directly. Functions that "change" the state return the new scalar; the
 * caller builds the next state (no hidden mutation).
 */
export interface TimeScaleState {
  /** Plot width in px (excluding the price axis), `> 0`. */
  width: number;
  /** Distance between adjacent bar centers (the bar slot width), px. */
  barSpacing: number;
  /** Empty bar slots right of the last bar; fractional allowed. */
  rightOffset: number;
  /** Number of stored bars. */
  barCount: number;
}

export interface TimeScaleOptions {
  minBarSpacing: number;
  maxBarSpacing: number;
  /** Upper pan bound: max realtime padding right of the last bar, bars. */
  maxRightOffsetBars: number;
  /** Lower pan bound: max whitespace left of the first bar, bars. */
  leftMarginBars: number;
  /** Bars that always stay on screen at either pan bound. */
  minVisibleBars: number;
}

/** Logical index at the right edge of the plot. */
export function rightEdgeIndex(state: TimeScaleState): number {
  'worklet';
  return state.barCount - 0.5 + state.rightOffset;
}

/** X of the center of (fractional) logical index `index`. */
export function indexToX(state: TimeScaleState, index: number): number {
  'worklet';
  return state.width - (rightEdgeIndex(state) - index) * state.barSpacing;
}

/** Fractional logical index under `x`; `NaN` for a degenerate scale. */
export function xToIndex(state: TimeScaleState, x: number): number {
  'worklet';
  if (!(state.barSpacing > 0)) {
    return NaN;
  }
  return rightEdgeIndex(state) - (state.width - x) / state.barSpacing;
}

/** Nearest whole bar index under `x` (may be outside `[0, barCount)`). */
export function xToNearestIndex(state: TimeScaleState, x: number): number {
  'worklet';
  return Math.round(xToIndex(state, x));
}

/** Number of bar slots that fit into the plot width (fractional). */
export function visibleBarCount(state: TimeScaleState): number {
  'worklet';
  return state.barSpacing > 0 ? state.width / state.barSpacing : 0;
}

/** Candle body width: `barSpacing * bodyRatio`, ratio clamped to `[0, 1]`. */
export function candleBodyWidth(barSpacing: number, bodyRatio: number): number {
  'worklet';
  const w = barSpacing * clamp(bodyRatio, 0, 1);
  return w > 0 && w < Infinity ? w : 0;
}

/** Clamps a bar spacing into the zoom limits (`NaN` → min). */
export function clampBarSpacing(
  barSpacing: number,
  options: TimeScaleOptions
): number {
  'worklet';
  return clamp(barSpacing, options.minBarSpacing, options.maxBarSpacing);
}

function panSlack(state: TimeScaleState, options: TimeScaleOptions): number {
  'worklet';
  const slack = visibleBarCount(state) - options.minVisibleBars;
  return slack > 0 ? slack : 0;
}

/**
 * Lowest allowed `rightOffset` (furthest into history): the left edge may
 * show at most `leftMarginBars` of whitespace before bar 0. When the data
 * does not fill the plot the two bounds swap, letting the user slide the
 * short series between left- and right-aligned.
 */
export function minRightOffset(
  state: TimeScaleState,
  options: TimeScaleOptions
): number {
  'worklet';
  const slack = panSlack(state, options);
  const lo =
    visibleBarCount(state) -
    Math.min(options.leftMarginBars, slack) -
    state.barCount;
  const hi = Math.min(options.maxRightOffsetBars, slack);
  return lo < hi ? lo : hi;
}

/** Highest allowed `rightOffset` (max realtime padding). */
export function maxRightOffset(
  state: TimeScaleState,
  options: TimeScaleOptions
): number {
  'worklet';
  const slack = panSlack(state, options);
  const lo =
    visibleBarCount(state) -
    Math.min(options.leftMarginBars, slack) -
    state.barCount;
  const hi = Math.min(options.maxRightOffsetBars, slack);
  return lo > hi ? lo : hi;
}

/**
 * `rightOffset` after dragging by `dx` px (positive = finger moves right =
 * reveal older bars). Unclamped; see `clampRightOffset`/`elasticRightOffset`.
 */
export function panRightOffset(state: TimeScaleState, dx: number): number {
  'worklet';
  if (!(state.barSpacing > 0) || !Number.isFinite(dx)) {
    return state.rightOffset;
  }
  return state.rightOffset - dx / state.barSpacing;
}

/** Hard-clamps a `rightOffset` into the pan bounds for `state`. */
export function clampRightOffset(
  state: TimeScaleState,
  rightOffset: number,
  options: TimeScaleOptions
): number {
  'worklet';
  return clamp(
    rightOffset,
    minRightOffset(state, options),
    maxRightOffset(state, options)
  );
}

/**
 * Rubber-band variant for use *during* a gesture: overshoot is compressed
 * and never exceeds `elasticBars`. Snap back with `clampRightOffset` (e.g.
 * `withSpring`) on release.
 */
export function elasticRightOffset(
  state: TimeScaleState,
  rightOffset: number,
  options: TimeScaleOptions,
  elasticBars: number
): number {
  'worklet';
  return rubberBand(
    rightOffset,
    minRightOffset(state, options),
    maxRightOffset(state, options),
    elasticBars
  );
}

/**
 * `rightOffset` that keeps the logical index under `focalX` fixed when the
 * bar spacing changes from `state.barSpacing` to `nextBarSpacing` (pass a
 * value already clamped with `clampBarSpacing`). Unclamped.
 */
export function zoomRightOffset(
  state: TimeScaleState,
  nextBarSpacing: number,
  focalX: number
): number {
  'worklet';
  const focalIndex = xToIndex(state, focalX);
  if (!(nextBarSpacing > 0) || !Number.isFinite(focalIndex)) {
    return state.rightOffset;
  }
  const nextRightEdge = focalIndex + (state.width - focalX) / nextBarSpacing;
  return nextRightEdge - state.barCount + 0.5;
}

/** Bar spacing that fits logical range `[from, to]` into the width. */
export function barSpacingForRange(
  width: number,
  from: number,
  to: number
): number {
  'worklet';
  const bars = to - from + 1;
  return bars > 0 && width > 0 ? width / bars : NaN;
}

/** `rightOffset` that puts logical index `to` at the rightmost slot. */
export function rightOffsetForRange(barCount: number, to: number): number {
  'worklet';
  return to - barCount + 1;
}

/** `true` when the last bar's center is inside the plot. */
export function isLastBarVisible(state: TimeScaleState): boolean {
  'worklet';
  const x = indexToX(state, state.barCount - 1);
  return state.barCount > 0 && x >= 0 && x <= state.width;
}
