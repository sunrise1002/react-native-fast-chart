/**
 * Test perspective table — LabelCache
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                   |
 * |------|--------------------------------------------------------|--------------------|--------------------------------------------|
 * | LC01 | createLabelCache default / 3.2 / 0 / -1 / NaN / ∞      | Equiv. / boundary  | 512 / 4 / 1 / 1 / 1 / 1 slots              |
 * | LC02 | store then lookup same (value, key)                    | Equivalence        | hit: text + lastWidth, hits 1              |
 * | LC03 | lookup before any store                                | Boundary (empty)   | null, misses 1                             |
 * | LC04 | same value, different key                              | Equivalence        | miss (keys never alias)                    |
 * | LC05 | two entries sharing a slot (1-slot cache)              | Boundary (min)     | last write wins, first misses              |
 * | LC06 | NaN / ±Infinity value, NaN key                         | Invalid            | always miss, never stored, lastWidth set   |
 * | LC07 | labelSlot for a tick grid / huge / negative values     | Equivalence        | in [0, size); grid spreads over many slots |
 * | LC08 | value 0 and -0                                         | Boundary (0)       | -0 hits the entry of 0 (same label)        |
 */
import { describe, expect, it } from '@jest/globals';
import {
  createLabelCache,
  LABEL_CACHE_CAPACITY,
  labelSlot,
  lookupLabel,
  storeLabel,
} from '../LabelCache';

describe('createLabelCache', () => {
  it.each([
    [undefined, LABEL_CACHE_CAPACITY],
    [3.2, 4],
    [0, 1],
    [-1, 1],
    [NaN, 1],
    [Infinity, 1],
  ])('LC01: capacity %p → %p slots', (capacity, size) => {
    // Given / When
    const cache = createLabelCache(capacity);
    // Then
    expect(cache.values.length).toBe(size);
    expect(cache.texts).toHaveLength(size);
    expect(cache.hits + cache.misses).toBe(0);
  });
});

describe('lookupLabel / storeLabel', () => {
  it('LC02: returns a stored label and its width', () => {
    // Given
    const cache = createLabelCache();
    expect(storeLabel(cache, 101.5, 2, '101.50', 36)).toBe('101.50');
    cache.lastWidth = 0;
    // When
    const text = lookupLabel(cache, 101.5, 2);
    // Then
    expect(text).toBe('101.50');
    expect(cache.lastWidth).toBe(36);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(0);
  });

  it('LC03: misses on an empty cache', () => {
    // Given
    const cache = createLabelCache();
    // When / Then
    expect(lookupLabel(cache, 0, 0)).toBeNull();
    expect(cache.misses).toBe(1);
  });

  it('LC04: distinguishes keys of the same value', () => {
    // Given
    const cache = createLabelCache();
    storeLabel(cache, 5, 2, '5.00', 24);
    // When / Then
    expect(lookupLabel(cache, 5, 3)).toBeNull();
    expect(lookupLabel(cache, 5, 2)).toBe('5.00');
  });

  it('LC05: a colliding store overwrites the slot', () => {
    // Given: one slot for everything
    const cache = createLabelCache(1);
    storeLabel(cache, 1, 0, '1', 6);
    // When
    storeLabel(cache, 2, 0, '2', 6);
    // Then
    expect(lookupLabel(cache, 1, 0)).toBeNull();
    expect(lookupLabel(cache, 2, 0)).toBe('2');
  });

  it.each([
    [NaN, 0],
    [Infinity, 0],
    [-Infinity, 0],
    [1, NaN],
  ])('LC06: never caches value %p / key %p', (value, key) => {
    // Given
    const cache = createLabelCache(1);
    // When
    const stored = storeLabel(cache, value, key, '', 7);
    // Then
    expect(stored).toBe('');
    expect(cache.lastWidth).toBe(7);
    expect(Number.isNaN(cache.values[0])).toBe(true);
    expect(lookupLabel(cache, value, key)).toBeNull();
    expect(cache.misses).toBe(1);
  });

  it('LC08: -0 shares the entry of 0', () => {
    // Given
    const cache = createLabelCache();
    storeLabel(cache, 0, 2, '0.00', 24);
    // When / Then
    expect(lookupLabel(cache, -0, 2)).toBe('0.00');
  });
});

describe('labelSlot', () => {
  it('LC07: stays in range and spreads a tick grid', () => {
    // Given
    const cache = createLabelCache();
    const slots = new Set<number>();
    // When
    for (let i = 0; i < 100; i++) {
      slots.add(labelSlot(cache, 64_000 + i * 50, 2));
    }
    const extremes = [1e300, -1e300, -12.5, 1.7e12].map((v) =>
      labelSlot(cache, v, 1)
    );
    // Then
    expect(slots.size).toBeGreaterThan(80);
    for (const s of [...slots, ...extremes]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(LABEL_CACHE_CAPACITY);
    }
    expect(labelSlot(cache, Infinity, 0)).toBe(0);
  });
});
