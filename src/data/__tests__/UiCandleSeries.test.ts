/**
 * Test perspective table — UiCandleSeries
 *
 * | Case | Input / Precondition                              | Perspective        | Expected                                   |
 * |------|---------------------------------------------------|--------------------|--------------------------------------------|
 * | U1   | 3 bars, offset 2, default headroom                | Equivalence        | copied from offset, capacity 3 + 256       |
 * | U2   | headroom 0 / -5 / NaN / ∞ / 2.7                   | Boundary / invalid | capacity 3 / 3 / 3 / 3 / 5                 |
 * | U3   | length -1 (corrupt)                               | Invalid            | empty series                               |
 * | U4   | revision / resetVersion carried                   | Equivalence        | kept                                       |
 * | U5   | emptyUiCandleSeries()                             | Boundary (empty)   | length 0, capacity 16                      |
 * | U6   | writeUiBar(index < length)                        | Equivalence        | overwrite, length same, revision +1        |
 * | U7   | writeUiBar(index === length) with room            | Boundary           | append, length +1                          |
 * | U8   | append when full (cap 3 → 16; cap 16 → 32)        | Boundary (+1)      | grows, old data preserved                  |
 * | U9   | index -1 / length + 1 / 0.5 / NaN / ∞             | Invalid            | false, series untouched                    |
 * | U10  | packBars valid slice (with offset)                | Equivalence        | 6 values per bar in order                  |
 * | U11  | packBars count beyond end / count 2.9             | Boundary           | clamped / floored                          |
 * | U12  | packBars from -1 / 0.5 / length / count 0/-1/NaN  | Boundary / invalid | empty                                      |
 * | U13  | applyPackedBars overwrite + append                | Equivalence        | written count, length updated              |
 * | U14  | applyPackedBars from -1 / length + 1 / 0.5 / NaN  | Invalid            | 0 written                                  |
 * | U15  | applyPackedBars partial stride / empty payload    | Boundary           | trailing values ignored / 0                |
 */
import { describe, expect, it } from '@jest/globals';
import type { CandleColumns } from '../CandleBuffer';
import {
  applyPackedBars,
  createUiCandleSeries,
  emptyUiCandleSeries,
  packBars,
  PACKED_BAR_STRIDE,
  UI_SERIES_HEADROOM,
  writeUiBar,
  type UiCandleSeries,
} from '../UiCandleSeries';

/** Bars with time = i, open = 10i, high = 10i + 5, … volume = i + 100. */
function columns(n: number, offset = 0): CandleColumns {
  const make = (f: (i: number) => number) => {
    const a = new Float64Array(n + offset).fill(-1);
    for (let i = 0; i < n; i++) {
      a[offset + i] = f(i);
    }
    return a;
  };
  return {
    time: make((i) => i),
    open: make((i) => 10 * i),
    high: make((i) => 10 * i + 5),
    low: make((i) => 10 * i - 5),
    close: make((i) => 10 * i + 1),
    volume: make((i) => i + 100),
    offset,
    length: n,
  };
}

function bar(s: UiCandleSeries, i: number): number[] {
  return [s.time, s.open, s.high, s.low, s.close, s.volume].map(
    (c) => c[i] as number
  );
}

describe('createUiCandleSeries', () => {
  it('U1: copies bars from the column offset with headroom', () => {
    // Given
    const src = columns(3, 2);
    // When
    const s = createUiCandleSeries(src);
    // Then
    expect(s.length).toBe(3);
    expect(s.offset).toBe(0);
    expect(s.time).toHaveLength(3 + UI_SERIES_HEADROOM);
    expect(bar(s, 0)).toEqual([0, 0, 5, -5, 1, 100]);
    expect(bar(s, 2)).toEqual([2, 20, 25, 15, 21, 102]);
    expect(s.time).not.toBe(src.time);
  });

  it.each([
    [0, 3],
    [-5, 3],
    [NaN, 3],
    [Infinity, 3],
    [2.7, 5],
  ])('U2: headroom %p → capacity %p', (headroom, capacity) => {
    // Given / When
    const s = createUiCandleSeries(columns(3), 0, 0, headroom);
    // Then
    expect(s.close).toHaveLength(capacity);
  });

  it('U3: treats a negative length as empty', () => {
    // Given
    const src = { ...columns(2), length: -1 };
    // When
    const s = createUiCandleSeries(src, 0, 0, 0);
    // Then
    expect(s.length).toBe(0);
    expect(s.time).toHaveLength(0);
  });

  it('U4: carries revision and resetVersion', () => {
    // Given / When
    const s = createUiCandleSeries(columns(1), 7, 3);
    // Then
    expect([s.revision, s.resetVersion]).toEqual([7, 3]);
  });

  it('U5: creates an empty series with small capacity', () => {
    // Given / When
    const s = emptyUiCandleSeries();
    // Then
    expect(s.length).toBe(0);
    expect(s.time).toHaveLength(16);
    expect(s.revision).toBe(0);
  });
});

describe('writeUiBar', () => {
  it('U6: overwrites an existing bar', () => {
    // Given
    const s = createUiCandleSeries(columns(3), 0, 0, 0);
    // When
    const ok = writeUiBar(s, 2, 9, 1, 2, 3, 4, 5);
    // Then
    expect(ok).toBe(true);
    expect(s.length).toBe(3);
    expect(s.revision).toBe(1);
    expect(bar(s, 2)).toEqual([9, 1, 2, 3, 4, 5]);
  });

  it('U7: appends at index === length', () => {
    // Given
    const s = createUiCandleSeries(columns(1), 0, 0, 4);
    const storage = s.time;
    // When
    const ok = writeUiBar(s, 1, 9, 1, 2, 3, 4, 5);
    // Then
    expect(ok).toBe(true);
    expect(s.length).toBe(2);
    expect(s.time).toBe(storage);
  });

  it.each([
    [3, 16],
    [16, 32],
  ])('U8: grows a full series of capacity %p to %p', (n, capacity) => {
    // Given
    const s = createUiCandleSeries(columns(n), 0, 0, 0);
    // When
    writeUiBar(s, n, 99, 1, 2, 3, 4, 5);
    // Then
    for (const c of [s.time, s.open, s.high, s.low, s.close, s.volume]) {
      expect(c).toHaveLength(capacity);
    }
    expect(bar(s, 0)).toEqual([0, 0, 5, -5, 1, 100]);
    expect(bar(s, n)).toEqual([99, 1, 2, 3, 4, 5]);
    expect(s.length).toBe(n + 1);
  });

  it.each([-1, 4, 0.5, NaN, Infinity])(
    'U9: rejects index %p without changes',
    (index) => {
      // Given
      const s = createUiCandleSeries(columns(3));
      const before = bar(s, 2);
      // When
      const ok = writeUiBar(s, index, 1, 1, 1, 1, 1, 1);
      // Then
      expect(ok).toBe(false);
      expect(s.length).toBe(3);
      expect(s.revision).toBe(0);
      expect(bar(s, 2)).toEqual(before);
    }
  );
});

describe('packBars / applyPackedBars', () => {
  it('U10: packs bars in stride order from the offset', () => {
    // Given / When
    const packed = packBars(columns(4, 1), 2, 2);
    // Then
    expect(packed).toHaveLength(2 * PACKED_BAR_STRIDE);
    expect(Array.from(packed)).toEqual([
      2, 20, 25, 15, 21, 102, 3, 30, 35, 25, 31, 103,
    ]);
  });

  it.each([
    [1, 10, 3],
    [0, 2.9, 2],
  ])('U11: from %p count %p → %p bars', (from, count, bars) => {
    // Given / When / Then
    expect(packBars(columns(4), from, count)).toHaveLength(
      bars * PACKED_BAR_STRIDE
    );
  });

  it.each([
    [-1, 1],
    [0.5, 1],
    [4, 1],
    [NaN, 1],
    [0, 0],
    [0, -1],
    [0, NaN],
  ])('U12: from %p count %p → empty', (from, count) => {
    // Given / When / Then
    expect(packBars(columns(4), from, count)).toHaveLength(0);
  });

  it('U13: applies overwrite + append in one payload', () => {
    // Given
    const s = createUiCandleSeries(columns(3), 0, 0, 0);
    const packed = packBars(columns(5), 2, 3);
    // When
    const written = applyPackedBars(s, 2, packed);
    // Then
    expect(written).toBe(3);
    expect(s.length).toBe(5);
    expect(bar(s, 4)).toEqual([4, 40, 45, 35, 41, 104]);
    expect(s.revision).toBe(3);
  });

  it.each([-1, 4, 0.5, NaN])('U14: rejects start %p', (from) => {
    // Given
    const s = createUiCandleSeries(columns(3));
    // When / Then
    expect(applyPackedBars(s, from, packBars(columns(1), 0, 1))).toBe(0);
    expect(s.revision).toBe(0);
  });

  it('U15: ignores a partial trailing bar and empty payloads', () => {
    // Given
    const s = createUiCandleSeries(columns(1));
    // When
    const partial = applyPackedBars(s, 1, [1, 2, 3, 4, 5, 6, 7, 8]);
    const empty = applyPackedBars(s, 0, []);
    // Then
    expect(partial).toBe(1);
    expect(empty).toBe(0);
    expect(s.length).toBe(2);
  });
});
