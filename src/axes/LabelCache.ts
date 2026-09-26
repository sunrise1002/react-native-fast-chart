/**
 * Direct-mapped cache of formatted axis labels and their widths (P8 text
 * audit, spec §17.4). Axis ticks repeat from frame to frame (a pan keeps
 * the price ticks, a zoom keeps most time ticks), so labels are formatted
 * and measured once per `(value, key)` instead of every frame. `key`
 * encodes the format parameters (decimals, tick weight, …) so different
 * formats of one value never alias. A slot holds one entry; a collision
 * simply overwrites it (the cache is a bound, never grows).
 *
 * The owner fixes the formatter, separator and glyph table for the cache's
 * lifetime (create a new cache when they change). Worklet-safe: typed
 * arrays + one string array, no allocation on hits.
 */
export interface LabelCache {
  values: Float64Array;
  keys: Float64Array;
  texts: string[];
  widths: Float64Array;
  /** Width of the text returned by the last lookup / store, dp. */
  lastWidth: number;
  /** Lookup statistics (tests / profiling). */
  hits: number;
  misses: number;
}

/** Default slot count: several screens of distinct tick labels. */
export const LABEL_CACHE_CAPACITY = 512;

export function createLabelCache(capacity = LABEL_CACHE_CAPACITY): LabelCache {
  const size = capacity >= 1 && capacity < Infinity ? Math.ceil(capacity) : 1;
  return {
    values: new Float64Array(size).fill(NaN),
    keys: new Float64Array(size).fill(NaN),
    texts: new Array<string>(size).fill(''),
    widths: new Float64Array(size),
    lastWidth: 0,
    hits: 0,
    misses: 0,
  };
}

/**
 * Slot of `(value, key)`: the fractional part of a multiplicative mix
 * (no bitwise ops) spreads tick grids (multiples of a step) over the
 * table. Non-finite mixes land in slot 0.
 */
export function labelSlot(
  cache: LabelCache,
  value: number,
  key: number
): number {
  'worklet';
  const size = cache.values.length;
  const mix = Math.abs(value * 0.6180339887 + key * 0.7548776662);
  const slot = Math.floor((mix - Math.floor(mix)) * size);
  return slot >= 0 && slot < size ? slot : 0;
}

/**
 * Cached text of `(value, key)`, or `null` on a miss (then format it and
 * call `storeLabel`). Non-finite values always miss and are never stored.
 * Sets `lastWidth` on a hit.
 */
export function lookupLabel(
  cache: LabelCache,
  value: number,
  key: number
): string | null {
  'worklet';
  if (Number.isFinite(value) && Number.isFinite(key)) {
    const slot = labelSlot(cache, value, key);
    if (cache.values[slot] === value && cache.keys[slot] === key) {
      cache.hits++;
      cache.lastWidth = cache.widths[slot] as number;
      return cache.texts[slot] as string;
    }
  }
  cache.misses++;
  return null;
}

/**
 * Stores `text` / `width` for `(value, key)` (overwriting the slot) and
 * returns `text`; sets `lastWidth`. Non-finite values are not stored.
 */
export function storeLabel(
  cache: LabelCache,
  value: number,
  key: number,
  text: string,
  width: number
): string {
  'worklet';
  cache.lastWidth = width;
  if (Number.isFinite(value) && Number.isFinite(key)) {
    const slot = labelSlot(cache, value, key);
    cache.values[slot] = value;
    cache.keys[slot] = key;
    cache.texts[slot] = text;
    cache.widths[slot] = width;
  }
  return text;
}
