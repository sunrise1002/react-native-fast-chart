/**
 * Test perspective table — ScaleMath
 *
 * | Case | Input / Precondition                    | Perspective        | Expected                                |
 * |------|-----------------------------------------|--------------------|-----------------------------------------|
 * | C1   | inside / below / above / at bounds      | Equiv. / Boundary  | value / min / max / bound               |
 * | C2   | NaN, ±Infinity                          | Abnormal           | min / max / min                         |
 * | R1   | value inside bounds                     | Equivalence        | unchanged                               |
 * | R2   | overshoot above / below                 | Equivalence        | compressed toward bound, < limit        |
 * | R3   | huge overshoot                          | Boundary (max)     | approaches but never exceeds limit      |
 * | R4   | limit 0 / negative / NaN                | Boundary / invalid | hard clamp                              |
 * | R5   | NaN value                               | Abnormal           | min                                     |
 * | R6   | monotonic in overshoot                  | Invariant          | larger overshoot → larger output        |
 * | F1   | areFinite with NaN / Infinity / finite  | Equiv. / Abnormal  | false / false / true                    |
 */
import { describe, expect, it } from '@jest/globals';
import { areFinite, clamp, rubberBand } from '../ScaleMath';

describe('clamp', () => {
  it.each([
    [5, 5],
    [-1, 0],
    [11, 10],
    [0, 0],
    [10, 10],
    [NaN, 0],
    [Infinity, 10],
    [-Infinity, 0],
  ])('C1/C2: clamp(%p, 0, 10) = %p', (v, expected) => {
    // Given / When / Then
    expect(clamp(v, 0, 10)).toBe(expected);
  });
});

describe('rubberBand', () => {
  it('R1: identity inside bounds', () => {
    // Given / When / Then
    expect(rubberBand(3, 0, 10, 5)).toBe(3);
  });

  it('R2: compresses overshoot on both sides', () => {
    // Given / When
    const above = rubberBand(12, 0, 10, 5);
    const below = rubberBand(-2, 0, 10, 5);
    // Then
    expect(above).toBeGreaterThan(10);
    expect(above).toBeLessThan(12);
    expect(below).toBeLessThan(0);
    expect(below).toBeGreaterThan(-2);
    expect(above - 10).toBeCloseTo(0 - below); // symmetric
  });

  it('R3: never exceeds the limit', () => {
    // Given / When
    const v = rubberBand(1e12, 0, 10, 5);
    // Then
    expect(v).toBeLessThanOrEqual(15);
    expect(v).toBeGreaterThan(14.9);
  });

  it.each([0, -1, NaN])('R4: limit %p hard-clamps', (limit) => {
    // Given / When / Then
    expect(rubberBand(12, 0, 10, limit)).toBe(10);
    expect(rubberBand(-3, 0, 10, limit)).toBe(0);
  });

  it('R5: NaN value maps to min', () => {
    // Given / When / Then
    expect(rubberBand(NaN, 0, 10, 5)).toBe(0);
  });

  it('R6: monotonic', () => {
    // Given / When
    const values = [11, 12, 15, 20, 100].map((v) => rubberBand(v, 0, 10, 5));
    // Then
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1] as number);
    }
  });
});

describe('areFinite', () => {
  it('F1: detects non-finite values', () => {
    // Given / When / Then
    expect(areFinite(1, 2)).toBe(true);
    expect(areFinite(1, 2, 3, 4)).toBe(true);
    expect(areFinite(NaN, 2)).toBe(false);
    expect(areFinite(1, Infinity)).toBe(false);
    expect(areFinite(1, 2, -Infinity)).toBe(false);
    expect(areFinite(1, 2, 3, NaN)).toBe(false);
  });
});
