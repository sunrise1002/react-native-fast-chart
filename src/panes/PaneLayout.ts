/*
 * Pane layout engine (spec §12.2, Phase 9.2): vertical frames of the
 * stacked panes from their height weights and minimum heights, the pane
 * under a touch, separator hit-testing and separator dragging. Pure and
 * worklet-compatible (runs on the UI thread on resize / drag; never per
 * frame).
 */

/** Weights and minimum heights of the panes, top to bottom. */
export interface PaneLayoutSpec {
  ids: readonly string[];
  ratios: readonly number[];
  minHeights: readonly number[];
}

/** Computed frames: pane `i` spans `[tops[i], tops[i] + heights[i])`, dp. */
export interface PaneLayoutFrame {
  ids: readonly string[];
  tops: number[];
  heights: number[];
  /** Total height of the stack (bottom of the last pane), dp. */
  total: number;
}

function validRatio(r: number | undefined): number {
  'worklet';
  return r !== undefined && r > 0 && r < Infinity ? r : 1;
}

function validMin(m: number | undefined): number {
  'worklet';
  return m !== undefined && m > 0 && m < Infinity ? m : 0;
}

/**
 * Heights proportional to the ratios, honoring the minimum heights: panes
 * that would fall below their minimum are pinned to it and the rest is
 * shared by the others. When even the minimums don't fit, every pane gets
 * a share proportional to its minimum. Tops are rounded to whole dp so
 * separators stay crisp; heights sum exactly to `total`.
 * Adding / removing a pane only rescales the others by their weights, so
 * the layout is stable.
 */
export function computePaneLayout(
  spec: PaneLayoutSpec,
  total: number
): PaneLayoutFrame {
  'worklet';
  const n = spec.ids.length;
  const height = total > 0 && total < Infinity ? total : 0;
  const raw: number[] = [];
  let sumMin = 0;
  for (let i = 0; i < n; i++) {
    raw.push(-1);
    sumMin += validMin(spec.minHeights[i]);
  }
  if (sumMin >= height) {
    for (let i = 0; i < n; i++) {
      raw[i] =
        sumMin > 0 ? (validMin(spec.minHeights[i]) * height) / sumMin : 0;
    }
  } else {
    // Pin panes under their minimum until the proportional split fits.
    let remaining = height;
    let pinned = true;
    while (pinned) {
      pinned = false;
      let sumRatio = 0;
      for (let i = 0; i < n; i++) {
        if (raw[i] === -1) {
          sumRatio += validRatio(spec.ratios[i]);
        }
      }
      for (let i = 0; i < n; i++) {
        const min = validMin(spec.minHeights[i]);
        if (
          raw[i] === -1 &&
          (remaining * validRatio(spec.ratios[i])) / sumRatio < min
        ) {
          raw[i] = min;
          remaining -= min;
          pinned = true;
        }
      }
      if (!pinned) {
        for (let i = 0; i < n; i++) {
          if (raw[i] === -1) {
            raw[i] = (remaining * validRatio(spec.ratios[i])) / sumRatio;
          }
        }
      }
    }
  }
  const tops: number[] = [];
  const heights: number[] = [];
  let cumulative = 0;
  let top = 0;
  for (let i = 0; i < n; i++) {
    cumulative += raw[i] as number;
    const bottom = i === n - 1 ? height : Math.round(cumulative);
    tops.push(top);
    heights.push(bottom > top ? bottom - top : 0);
    top = bottom > top ? bottom : top;
  }
  return { ids: spec.ids, tops, heights, total: height };
}

/** Index of the pane containing `y` (clamped to the stack), `-1` if empty. */
export function paneIndexAt(frame: PaneLayoutFrame, y: number): number {
  'worklet';
  const n = frame.tops.length;
  if (n === 0 || Number.isNaN(y)) {
    return -1;
  }
  for (let i = n - 1; i > 0; i--) {
    if (y >= (frame.tops[i] as number)) {
      return i;
    }
  }
  return 0;
}

/**
 * Separator nearest to `y` within `slop` dp: returns `i` for the boundary
 * above pane `i` (`1 … n − 1`), or `-1`.
 */
export function hitTestSeparator(
  frame: PaneLayoutFrame,
  y: number,
  slop: number
): number {
  'worklet';
  let best = -1;
  let bestDistance = slop >= 0 ? slop : 0;
  for (let i = 1; i < frame.tops.length; i++) {
    const distance = Math.abs(y - (frame.tops[i] as number));
    if (distance <= bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Ratios after dragging separator `index` (above pane `index`) by `dy` dp
 * from the layout `start`: height moves between the two adjacent panes
 * only (clamped by their minimum heights) and their combined weight is
 * preserved, so every other pane keeps its size. Returns a new array;
 * invalid input returns the unchanged ratios.
 */
export function dragSeparator(
  spec: PaneLayoutSpec,
  start: PaneLayoutFrame,
  index: number,
  dy: number
): number[] {
  'worklet';
  const ratios: number[] = [];
  for (let i = 0; i < spec.ratios.length; i++) {
    ratios.push(validRatio(spec.ratios[i]));
  }
  const above = index - 1;
  if (
    !(index >= 1 && index < ratios.length) ||
    index % 1 !== 0 ||
    !Number.isFinite(dy) ||
    start.heights.length !== ratios.length
  ) {
    return ratios;
  }
  const hA = start.heights[above] as number;
  const hB = start.heights[index] as number;
  const pair = hA + hB;
  // At least 1 dp each, so neither weight can collapse to 0.
  const minA = Math.max(1, validMin(spec.minHeights[above]));
  const minB = Math.max(1, validMin(spec.minHeights[index]));
  if (!(pair > 0) || minA + minB > pair) {
    return ratios;
  }
  let next = hA + dy;
  next = next < minA ? minA : next > pair - minB ? pair - minB : next;
  const weight = (ratios[above] as number) + (ratios[index] as number);
  ratios[above] = (weight * next) / pair;
  ratios[index] = weight - (ratios[above] as number);
  return ratios;
}
