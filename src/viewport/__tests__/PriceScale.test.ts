/**
 * Test perspective table — PriceScale
 *
 * | Case | Input / Precondition                             | Perspective        | Expected                                  |
 * |------|--------------------------------------------------|--------------------|-------------------------------------------|
 * | N1   | normal range                                     | Equivalence        | unchanged                                 |
 * | N2   | reversed range                                   | Abnormal           | swapped                                   |
 * | N3   | flat range v..v (v ≠ 0)                          | Boundary (0 width) | v ± 1 %                                   |
 * | N4   | flat range 0..0                                  | Boundary (0)       | -1..1                                     |
 * | N5   | one end NaN / ±Infinity                          | Abnormal           | the finite end, synthesized               |
 * | N6   | both ends non-finite                             | Abnormal           | fallback 0..1                             |
 * | N7   | ±1e308                                           | Boundary (max)     | clamped, finite span                      |
 * | N8   | tiny non-flat range (1e-9 wide around 1e-3)      | Boundary (min)     | kept                                      |
 * | S1   | default padding 10 %                             | Equivalence        | display range padded both sides           |
 * | S2   | custom / negative / NaN / > 10 padding           | Boundary / invalid | used / 0 / default / 10                   |
 * | S3   | NaN top, negative / NaN height                   | Invalid            | top 0, height 0                           |
 * | Y1   | max → top, min → bottom (inverted Y)             | Equivalence        | exact pixel edges                         |
 * | Y2   | price ↔ y round trip                             | Invariant          | 1e-9 relative                             |
 * | Y3   | NaN / Infinity price or y                        | Abnormal           | NaN (caller must skip)                    |
 * | Y4   | zero-height pane                                 | Boundary (0)       | y = top, yToPrice = mid                   |
 * | Y5   | extreme range                                    | Boundary (max)     | finite y for finite prices                |
 */
import { describe, expect, it } from '@jest/globals';
import {
  createPriceScale,
  DEGENERATE_RANGE_RATIO,
  FALLBACK_PRICE_RANGE,
  normalizePriceRange,
  priceToY,
  yToPrice,
} from '../PriceScale';

describe('normalizePriceRange', () => {
  it('N1: keeps a normal range', () => {
    // Given / When / Then
    expect(normalizePriceRange(10, 20)).toEqual({ min: 10, max: 20 });
  });

  it('N2: swaps a reversed range', () => {
    // Given / When / Then
    expect(normalizePriceRange(20, 10)).toEqual({ min: 10, max: 20 });
  });

  it('N3: synthesizes a range around a flat price', () => {
    // Given / When
    const r = normalizePriceRange(100, 100);
    // Then
    expect(DEGENERATE_RANGE_RATIO).toBe(0.01);
    expect(r).toEqual({ min: 99, max: 101 });
  });

  it('N4: flat zero', () => {
    // Given / When / Then
    expect(normalizePriceRange(0, 0)).toEqual({ min: -1, max: 1 });
  });

  it.each([
    [NaN, 50],
    [50, NaN],
    [-Infinity, 50],
    [50, Infinity],
  ])('N5: (%p, %p) uses the finite end', (a, b) => {
    // Given / When / Then
    expect(normalizePriceRange(a, b)).toEqual({ min: 49.5, max: 50.5 });
  });

  it.each([
    [NaN, NaN],
    [Infinity, -Infinity],
  ])('N6: (%p, %p) falls back', (a, b) => {
    // Given / When / Then
    expect(normalizePriceRange(a, b)).toEqual(FALLBACK_PRICE_RANGE);
  });

  it('N7: clamps huge values to a finite span', () => {
    // Given / When
    const r = normalizePriceRange(-1e308, 1e308);
    // Then
    expect(Number.isFinite(r.max - r.min)).toBe(true);
  });

  it('N8: keeps tiny but real ranges', () => {
    // Given / When / Then
    expect(normalizePriceRange(0.001, 0.001000001)).toEqual({
      min: 0.001,
      max: 0.001000001,
    });
  });
});

describe('createPriceScale / priceToY / yToPrice', () => {
  it('S1: default 10 % padding', () => {
    // Given / When
    const s = createPriceScale({ min: 100, max: 200 }, 0, 500);
    // Then
    expect(s).toEqual({
      mode: 'linear',
      top: 0,
      height: 500,
      min: 90,
      max: 210,
    });
  });

  it.each([
    [{ paddingTop: 0.5, paddingBottom: 0 }, 100, 250],
    [{ paddingTop: -1, paddingBottom: -1 }, 100, 200],
    [{ paddingTop: NaN }, 90, 210],
    [{ paddingTop: 99, paddingBottom: 0 }, 100, 1200],
  ])('S2: padding %p → [%p, %p]', (options, min, max) => {
    // Given / When
    const s = createPriceScale({ min: 100, max: 200 }, 0, 100, options);
    // Then
    expect(s.min).toBeCloseTo(min, 9);
    expect(s.max).toBeCloseTo(max, 9);
  });

  it.each([
    [NaN, 100, 0, 100],
    [10, -5, 10, 0],
    [10, NaN, 10, 0],
    [10, Infinity, 10, 0],
  ])('S3: rect (%p, %p) → top %p height %p', (top, height, t, h) => {
    // Given / When
    const s = createPriceScale({ min: 0, max: 1 }, top, height);
    // Then
    expect(s.top).toBe(t);
    expect(s.height).toBe(h);
  });

  it('Y1: inverted Y with exact edges', () => {
    // Given
    const s = createPriceScale({ min: 100, max: 200 }, 20, 400, {
      paddingTop: 0,
      paddingBottom: 0,
    });
    // When / Then
    expect(priceToY(s, 200)).toBe(20);
    expect(priceToY(s, 100)).toBe(420);
    expect(priceToY(s, 150)).toBe(220);
    expect(yToPrice(s, 20)).toBe(200);
    expect(yToPrice(s, 420)).toBe(100);
  });

  it('Y2: round trip', () => {
    // Given
    const s = createPriceScale({ min: 0.00001234, max: 0.00005678 }, 10, 333);
    // When / Then
    for (let k = 0; k <= 100; k++) {
      const price = s.min + ((s.max - s.min) * k) / 100;
      expect(yToPrice(s, priceToY(s, price))).toBeCloseTo(price, 15);
    }
  });

  it.each([NaN, Infinity, -Infinity])('Y3: %p maps to NaN', (v) => {
    // Given
    const s = createPriceScale({ min: 0, max: 1 }, 0, 100);
    // When / Then
    expect(priceToY(s, v)).toBeNaN();
    expect(yToPrice(s, v)).toBeNaN();
  });

  it('Y4: zero-height pane', () => {
    // Given
    const s = createPriceScale({ min: 10, max: 20 }, 50, 0, {
      paddingTop: 0,
      paddingBottom: 0,
    });
    // When / Then
    expect(priceToY(s, 15)).toBe(50);
    expect(yToPrice(s, 50)).toBe(15);
  });

  it('Y5: extreme ranges still produce finite coordinates', () => {
    // Given
    const s = createPriceScale({ min: -1e308, max: 1e308 }, 0, 1000);
    // When / Then
    expect(Number.isFinite(priceToY(s, 0))).toBe(true);
    expect(Number.isFinite(priceToY(s, 1e300))).toBe(true);
  });
});
