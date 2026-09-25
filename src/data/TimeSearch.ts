/**
 * Binary searches over a sorted time column stored as `column[offset + i]`,
 * `0 <= i < length` (the `CandleColumns` layout). All functions return
 * **logical** indices, never allocate and are worklet-compatible.
 */

/** First index whose time is `>= time`; `length` when none. */
export function lowerBound(
  column: ArrayLike<number>,
  offset: number,
  length: number,
  time: number
): number {
  'worklet';
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((column[offset + mid] as number) < time) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** First index whose time is `> time`; `length` when none. */
export function upperBound(
  column: ArrayLike<number>,
  offset: number,
  length: number,
  time: number
): number {
  'worklet';
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((column[offset + mid] as number) <= time) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Index of the bar with exactly `time`, or `-1`. */
export function findExactIndex(
  column: ArrayLike<number>,
  offset: number,
  length: number,
  time: number
): number {
  'worklet';
  const i = lowerBound(column, offset, length, time);
  return i < length && column[offset + i] === time ? i : -1;
}

/**
 * Index of the bar closest to `time` (ties resolve to the earlier bar), or
 * `-1` when empty or `time` is NaN.
 */
export function findNearest(
  column: ArrayLike<number>,
  offset: number,
  length: number,
  time: number
): number {
  'worklet';
  if (length === 0 || Number.isNaN(time)) {
    return -1;
  }
  const i = lowerBound(column, offset, length, time);
  if (i === 0) {
    return 0;
  }
  if (i === length) {
    return length - 1;
  }
  const before = time - (column[offset + i - 1] as number);
  const after = (column[offset + i] as number) - time;
  return after < before ? i : i - 1;
}
