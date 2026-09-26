/**
 * Min/max pyramid over a numeric column (spec §23.3, Phase 18).
 *
 * Level `L >= 1` holds one bucket per `2^L` consecutive bars, anchored at
 * bar 0: bucket `b` covers bars `[b·2^L, (b+1)·2^L)` (the last bucket of a
 * level may be partial). Each bucket stores the min of the `min` source
 * and the max of the `max` source over its bars, skipping `NaN` / ±∞
 * (an empty bucket holds `+∞` / `−∞`). Level 0 is the source itself.
 *
 * Uses:
 * - pixel-bucket conflation: a power-of-two group of bars is one bucket
 *   (candle high/low, indicator envelopes) — O(1) per rendered bucket;
 * - range min/max in O(log n) (auto-scale at extreme zoom-out).
 *
 * Building is O(n) once; realtime updates recompute only the buckets that
 * contain the changed bars (O(changed + log n)). Memory: two `Float64Array`s
 * of ≈ `capacity` buckets in total (n/2 + n/4 + …), 16 B per bar.
 *
 * Pure TypeScript, worklet-compatible, allocation-free except when the
 * capacity grows (amortized, ×2).
 */

/** Minimal column view: bar `i` is at `column[offset + i]`. */
export type PyramidSource = ArrayLike<number>;

export interface MinMaxPyramid {
  /** Bars covered by the last `syncPyramid`. */
  length: number;
  /** Levels built (level `L` groups `2^L` bars). */
  levels: number;
  /** Bars the buffers are laid out for (power of two). */
  capacity: number;
  /** Start of level `L` inside `min` / `max` (index `L`, `L >= 1`). */
  starts: Int32Array;
  min: Float64Array;
  max: Float64Array;
}

/** Deepest level supported (2^30 bars per bucket). */
export const MAX_PYRAMID_LEVEL = 30;

const MIN_CAPACITY = 16;

function capacityFor(length: number): number {
  'worklet';
  let capacity = MIN_CAPACITY;
  while (capacity < length && capacity < 2 ** MAX_PYRAMID_LEVEL) {
    capacity *= 2;
  }
  return capacity;
}

function layout(pyramid: MinMaxPyramid, capacity: number): void {
  'worklet';
  let total = 0;
  pyramid.starts[0] = 0;
  for (let level = 1; level <= MAX_PYRAMID_LEVEL; level++) {
    pyramid.starts[level] = total;
    total += Math.ceil(capacity / 2 ** level);
  }
  pyramid.capacity = capacity;
  pyramid.min = new Float64Array(total);
  pyramid.max = new Float64Array(total);
}

/** An empty pyramid; buffers grow on the first `syncPyramid`. */
export function createMinMaxPyramid(capacity = 0): MinMaxPyramid {
  'worklet';
  const pyramid: MinMaxPyramid = {
    length: 0,
    levels: 0,
    capacity: 0,
    starts: new Int32Array(MAX_PYRAMID_LEVEL + 1),
    min: new Float64Array(0),
    max: new Float64Array(0),
  };
  layout(pyramid, capacityFor(capacity > 0 ? capacity : 0));
  return pyramid;
}

/** Number of buckets of `level` for `length` bars (level 0 = bars). */
export function bucketCount(length: number, level: number): number {
  'worklet';
  return length > 0 ? Math.ceil(length / 2 ** level) : 0;
}

/** Levels needed so the top level holds a single bucket. */
export function levelsFor(length: number): number {
  'worklet';
  let levels = 0;
  while (bucketCount(length, levels) > 1 && levels < MAX_PYRAMID_LEVEL) {
    levels++;
  }
  return levels;
}

/**
 * Brings the pyramid up to date with `length` bars whose values changed
 * from bar `from` on (`0` = full rebuild). Growing past the capacity
 * reallocates and rebuilds everything. Values beyond `length` are ignored,
 * so shrinking only needs `from <= length`.
 */
export function syncPyramid(
  pyramid: MinMaxPyramid,
  minSource: PyramidSource,
  maxSource: PyramidSource,
  offset: number,
  length: number,
  from: number
): void {
  'worklet';
  const n = length > 0 && length < Infinity ? Math.floor(length) : 0;
  let start = from > 0 ? Math.floor(from) : 0;
  if (n > pyramid.capacity) {
    layout(pyramid, capacityFor(n));
    start = 0;
  }
  if (!(start < n)) {
    start = n > 0 ? n - 1 : 0;
  }
  const levels = levelsFor(n);
  const { starts, min, max } = pyramid;
  for (let level = 1; level <= levels; level++) {
    const base = starts[level] as number;
    const buckets = bucketCount(n, level);
    const first = Math.floor(start / 2 ** level);
    if (level === 1) {
      for (let b = first; b < buckets; b++) {
        const i = offset + 2 * b;
        let lo = Infinity;
        let hi = -Infinity;
        const l0 = minSource[i] as number;
        const h0 = maxSource[i] as number;
        // NaN fails every comparison; ±∞ never beats the ±∞ seeds.
        if (l0 < lo && l0 !== -Infinity) lo = l0;
        if (h0 > hi && h0 !== Infinity) hi = h0;
        if (2 * b + 1 < n) {
          const l1 = minSource[i + 1] as number;
          const h1 = maxSource[i + 1] as number;
          if (l1 < lo && l1 !== -Infinity) lo = l1;
          if (h1 > hi && h1 !== Infinity) hi = h1;
        }
        min[base + b] = lo;
        max[base + b] = hi;
      }
      continue;
    }
    const child = starts[level - 1] as number;
    const children = bucketCount(n, level - 1);
    for (let b = first; b < buckets; b++) {
      const c = child + 2 * b;
      let lo = min[c] as number;
      let hi = max[c] as number;
      if (2 * b + 1 < children) {
        const l1 = min[c + 1] as number;
        const h1 = max[c + 1] as number;
        if (l1 < lo) lo = l1;
        if (h1 > hi) hi = h1;
      }
      min[base + b] = lo;
      max[base + b] = hi;
    }
  }
  pyramid.length = n;
  pyramid.levels = levels;
}

/** Min of bucket `b` at `level >= 1` (`+∞` when it holds no finite value). */
export function bucketMin(
  pyramid: MinMaxPyramid,
  level: number,
  b: number
): number {
  'worklet';
  return pyramid.min[(pyramid.starts[level] as number) + b] as number;
}

/** Max of bucket `b` at `level >= 1` (`−∞` when it holds no finite value). */
export function bucketMax(
  pyramid: MinMaxPyramid,
  level: number,
  b: number
): number {
  'worklet';
  return pyramid.max[(pyramid.starts[level] as number) + b] as number;
}

/**
 * Widens `out` with the finite min / max over bars `[start, end]`
 * (inclusive, clamped to the synced length) using aligned power-of-two
 * blocks: O(log n) lookups. The sources must be the ones the pyramid was
 * synced from. Returns `true` when a finite value was found.
 */
export function pyramidRangeMinMax(
  pyramid: MinMaxPyramid,
  minSource: PyramidSource,
  maxSource: PyramidSource,
  offset: number,
  start: number,
  end: number,
  out: { min: number; max: number }
): boolean {
  'worklet';
  const n = pyramid.length;
  // NaN bounds stay NaN (→ empty range); others clamp to the data.
  const a = start <= 0 ? 0 : Math.ceil(start);
  const b = end >= n - 1 ? n - 1 : Math.floor(end);
  if (!(a <= b)) {
    return false;
  }
  let lo = Infinity;
  let hi = -Infinity;
  let i = a;
  while (i <= b) {
    let level = 0;
    while (
      level < pyramid.levels &&
      i % 2 ** (level + 1) === 0 &&
      i + 2 ** (level + 1) - 1 <= b
    ) {
      level++;
    }
    let l: number;
    let h: number;
    if (level === 0) {
      l = minSource[offset + i] as number;
      h = maxSource[offset + i] as number;
      if (l === -Infinity) l = NaN;
      if (h === Infinity) h = NaN;
    } else {
      const k = (pyramid.starts[level] as number) + i / 2 ** level;
      l = pyramid.min[k] as number;
      h = pyramid.max[k] as number;
    }
    if (l < lo) lo = l;
    if (h > hi) hi = h;
    i += 2 ** level;
  }
  if (lo === Infinity || hi === -Infinity) {
    return false;
  }
  if (lo < out.min || Number.isNaN(out.min)) out.min = lo;
  if (hi > out.max || Number.isNaN(out.max)) out.max = hi;
  return true;
}
