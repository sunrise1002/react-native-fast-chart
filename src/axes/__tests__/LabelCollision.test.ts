/**
 * Test perspective table — LabelCollision
 *
 * | Case | Input / Precondition                                  | Perspective        | Expected                                  |
 * |------|-------------------------------------------------------|--------------------|-------------------------------------------|
 * | LC1  | overlapping / disjoint / touching ranges              | Equivalence/Bound. | true / false / false (touching)           |
 * | LC2  | gap makes near ranges collide                         | Boundary           | true within gap, false at gap             |
 * | LC3  | clampSpan centered / top edge / bottom edge           | Equivalence        | centered / min / max - size               |
 * | LC4  | clampSpan span larger than room                       | Boundary           | aligned to min                            |
 * | LC5  | clampSpan NaN center / NaN size                       | Invalid            | NaN                                       |
 * | LC6  | thin: equal weights closer than min distance          | Equivalence        | earlier tick kept                         |
 * | LC7  | thin: heavier tick replaces lighter neighbours        | Equivalence        | heavy tick kept, payload moved with it    |
 * | LC8  | thin: distance exactly = min                          | Boundary           | both kept                                 |
 * | LC9  | thin: minDistance 0 / -1 / NaN                        | Invalid            | unchanged                                 |
 * | LC10 | thin: empty set                                       | Boundary (empty)   | 0                                         |
 */
import { describe, expect, it } from '@jest/globals';
import {
  clampSpan,
  rangesOverlap,
  thinTicksBySpacing,
  type WeightedTicks,
} from '../LabelCollision';

function ticks(entries: [number, number][]): WeightedTicks {
  return {
    positions: Float64Array.from(entries.map((e) => e[0])),
    weights: Uint8Array.from(entries.map((e) => e[1])),
    payload: Float64Array.from(entries.map((e) => e[0] * 10)),
    count: entries.length,
  };
}

const kept = (t: WeightedTicks) => Array.from(t.positions.subarray(0, t.count));

describe('rangesOverlap', () => {
  it.each([
    [0, 10, 5, 15, true],
    [5, 15, 0, 10, true],
    [0, 10, 20, 30, false],
    [0, 10, 10, 20, false],
  ])('LC1: [%p,%p] vs [%p,%p] → %p', (a0, a1, b0, b1, expected) => {
    // Given / When / Then
    expect(rangesOverlap(a0, a1, b0, b1)).toBe(expected);
  });

  it('LC2: honors the gap', () => {
    // Given / When / Then
    expect(rangesOverlap(0, 10, 11, 20, 2)).toBe(true);
    expect(rangesOverlap(0, 10, 12, 20, 2)).toBe(false);
  });
});

describe('clampSpan', () => {
  it.each([
    [50, 10, 45],
    [2, 10, 0],
    [99, 10, 90],
  ])('LC3: center %p, size %p → %p', (center, size, expected) => {
    // Given / When / Then
    expect(clampSpan(center, size, 0, 100)).toBe(expected);
  });

  it('LC4: aligns an oversized span to min', () => {
    // Given / When / Then
    expect(clampSpan(50, 200, 0, 100)).toBe(0);
  });

  it.each([
    [NaN, 10],
    [50, NaN],
  ])('LC5: center %p, size %p → NaN', (center, size) => {
    // Given / When / Then
    expect(clampSpan(center, size, 0, 100)).toBeNaN();
  });
});

describe('thinTicksBySpacing', () => {
  it('LC6: keeps the earlier of equal-weight neighbours', () => {
    // Given
    const t = ticks([
      [0, 1],
      [2, 1],
      [5, 1],
      [6, 1],
    ]);
    // When
    const count = thinTicksBySpacing(t, 4);
    // Then
    expect(count).toBe(2);
    expect(kept(t)).toEqual([0, 5]);
  });

  it('LC7: a heavier tick replaces lighter neighbours', () => {
    // Given: month boundary (3) at 3 collides with days before it
    const t = ticks([
      [0, 2],
      [2, 1],
      [3, 3],
      [5, 2],
      [10, 1],
    ]);
    // When
    thinTicksBySpacing(t, 4);
    // Then
    expect(kept(t)).toEqual([3, 10]);
    expect(Array.from(t.weights.subarray(0, t.count))).toEqual([3, 1]);
    expect(Array.from(t.payload.subarray(0, t.count))).toEqual([30, 100]);
  });

  it('LC8: keeps ticks exactly minDistance apart', () => {
    // Given
    const t = ticks([
      [0, 1],
      [4, 1],
    ]);
    // When / Then
    expect(thinTicksBySpacing(t, 4)).toBe(2);
  });

  it.each([[0], [-1], [NaN]])('LC9: minDistance %p → unchanged', (d) => {
    // Given
    const t = ticks([
      [0, 1],
      [0.1, 1],
    ]);
    // When / Then
    expect(thinTicksBySpacing(t, d)).toBe(2);
  });

  it('LC10: empty set', () => {
    // Given / When / Then
    expect(thinTicksBySpacing(ticks([]), 4)).toBe(0);
  });
});
