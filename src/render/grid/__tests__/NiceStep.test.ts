/**
 * Test perspective table — NiceStep
 *
 * | Case | Input / Precondition                          | Perspective        | Expected                   |
 * |------|-----------------------------------------------|--------------------|----------------------------|
 * | N1   | raw 1 / 2 / 5 / 10 (exact nice values)        | Boundary           | unchanged                  |
 * | N2   | raw 1.01 / 2.01 / 5.01                        | Boundary (+ε)      | 2 / 5 / 10                 |
 * | N3   | raw 0.0003 / 7300                             | Equivalence        | 0.0005 / 10000             |
 * | N4   | span 0 / -1 / NaN / ∞, count 0 / NaN          | Boundary / invalid | NaN                        |
 * | N5   | raw overflowing to ∞ step (1e308 × 10)        | Boundary (huge)    | NaN                        |
 * | N6   | nicePriceStep(0, 100, 600, 60)                | Equivalence        | 10                         |
 * | N7   | nicePriceStep height/spacing 0 / NaN          | Invalid            | NaN                        |
 * | N8   | niceBarStep(10, 90) / (100, 90) / (0.5, 90)   | Equivalence / min  | 10 / 1 / 200               |
 * | N9   | niceBarStep spacing 0 / NaN / ∞, px 0         | Invalid            | NaN                        |
 */
import { describe, expect, it } from '@jest/globals';
import { niceBarStep, nicePriceStep, niceStep } from '../NiceStep';

describe('niceStep', () => {
  it.each([1, 2, 5, 10])('N1: keeps exact nice value %p', (v) => {
    // Given / When / Then
    expect(niceStep(v, 1)).toBe(v);
  });

  it.each([
    [1.01, 2],
    [2.01, 5],
    [5.01, 10],
  ])('N2: rounds %p up to %p', (raw, step) => {
    // Given / When / Then
    expect(niceStep(raw, 1)).toBe(step);
  });

  it('N3: works across magnitudes', () => {
    // Given / When / Then
    expect(niceStep(0.0003, 1)).toBeCloseTo(0.0005, 12);
    expect(niceStep(73000, 10)).toBe(10000);
  });

  it.each([
    [0, 1],
    [-1, 1],
    [NaN, 1],
    [Infinity, 1],
    [10, 0],
    [10, NaN],
  ])('N4: span %p / count %p → NaN', (span, count) => {
    // Given / When / Then
    expect(niceStep(span, count)).toBeNaN();
  });

  it('N5: returns NaN when the step overflows', () => {
    // Given: raw 1.5e308 → nice 2e308 = ∞
    // When / Then
    expect(niceStep(1.5e308, 1)).toBeNaN();
  });
});

describe('nicePriceStep', () => {
  it('N6: targets one line per spacing', () => {
    // Given / When / Then: 100 / (600 / 60) = 10
    expect(nicePriceStep(0, 100, 600, 60)).toBe(10);
  });

  it.each([
    [0, 60],
    [NaN, 60],
    [600, 0],
    [600, NaN],
  ])('N7: height %p / spacing %p → NaN', (h, s) => {
    // Given / When / Then
    expect(nicePriceStep(0, 100, h, s)).toBeNaN();
  });
});

describe('niceBarStep', () => {
  it.each([
    [10, 90, 10],
    [100, 90, 1],
    [90, 90, 1],
    [0.5, 90, 200],
  ])('N8: spacing %p, px %p → %p bars', (spacing, px, step) => {
    // Given / When / Then
    expect(niceBarStep(spacing, px)).toBe(step);
  });

  it.each([
    [0, 90],
    [NaN, 90],
    [Infinity, 90],
    [10, 0],
  ])('N9: spacing %p / px %p → NaN', (spacing, px) => {
    // Given / When / Then
    expect(niceBarStep(spacing, px)).toBeNaN();
  });
});
