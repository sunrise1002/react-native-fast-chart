/**
 * Test perspective table — computeCandleMetrics
 *
 * | Case | Input / Precondition                                   | Perspective         | Expected                                        |
 * |------|--------------------------------------------------------|---------------------|-------------------------------------------------|
 * | M1   | spacing 8, ratio .8, wick 1, pr 1                      | Equivalence         | body 5 px (odd parity with 1 px wick)           |
 * | M2   | pr 3 / pr 2 (even wick)                                | Equivalence         | 19 px / 12 px, parity matches wick              |
 * | M3   | body = wick + 2 / wick + 1                             | Boundary            | candles / wick-only                             |
 * | M4   | spacing 0 / NaN / ∞ / negative                         | Boundary / invalid  | body 1 px, wick-only                            |
 * | M5   | bodyRatio > 1 / < 0 / NaN                              | Boundary / invalid  | clamped to 1 / 0 / 0                            |
 * | M6   | pixelRatio 0 / NaN / -1 / ∞                            | Invalid             | pr 1                                            |
 * | M7   | wickWidth 0 / NaN / -2 / 2.4                           | Invalid / equiv.    | 1 / 1 / 1 / 2 px                                |
 * | M8   | `out` object                                           | Equivalence         | same object returned                            |
 */
import { describe, expect, it } from '@jest/globals';
import {
  computeCandleMetrics,
  createCandleMetrics,
  MIN_BODY_OVER_WICK_PX,
  type CandleMetrics,
} from '../CandleGeometry';

function metrics(spacing = 10, pr = 1, ratio = 0.8, wick = 1): CandleMetrics {
  return computeCandleMetrics(spacing, ratio, wick, pr, createCandleMetrics());
}

describe('computeCandleMetrics', () => {
  it('M1: floors the body and matches the wick parity', () => {
    // Given / When
    const m = metrics(8, 1, 0.8, 1);
    // Then: floor(6.4) = 6 → 5 so the 1 px wick is centered
    expect(m).toEqual({
      wickOnly: false,
      bodyWidthPx: 5,
      wickWidthPx: 1,
      pixelRatio: 1,
    });
  });

  it('M2: scales with the pixel ratio', () => {
    // Given / When
    const m3 = metrics(8, 3, 0.8, 1);
    const m2 = metrics(8, 2, 0.8, 1);
    // Then
    expect([m3.bodyWidthPx, m3.wickWidthPx]).toEqual([19, 3]);
    expect([m2.bodyWidthPx, m2.wickWidthPx]).toEqual([12, 2]);
  });

  it('M3: switches to wick-only when the body is not 2 px wider', () => {
    // Given: ratio 1, pr 1, 1 px wick → body = floor(spacing)
    // When
    const atLimit = metrics(1 + MIN_BODY_OVER_WICK_PX, 1, 1, 1);
    const below = metrics(2.99, 1, 1, 1);
    // Then
    expect(atLimit.wickOnly).toBe(false);
    expect(atLimit.bodyWidthPx).toBe(3);
    expect(below.wickOnly).toBe(true);
    expect(below.bodyWidthPx).toBe(2);
  });

  it.each([0, NaN, Infinity, -5])(
    'M4: degenerate spacing %p → 1 px wick-only',
    (spacing) => {
      // Given / When
      const m = metrics(spacing);
      // Then
      expect(m.bodyWidthPx).toBe(1);
      expect(m.wickOnly).toBe(true);
    }
  );

  it.each([
    [2, 10],
    [-1, 1],
    [NaN, 1],
  ])('M5: bodyRatio %p is clamped (body %p px)', (ratio, body) => {
    // Given / When
    const m = metrics(10, 1, ratio, 1);
    // Then (ratio 1 → 10 px → 9 for parity; 0 → 1 px)
    expect(m.bodyWidthPx).toBe(body === 10 ? 9 : body);
  });

  it.each([0, NaN, -1, Infinity])('M6: pixelRatio %p falls back to 1', (pr) => {
    // Given / When / Then
    expect(metrics(10, pr).pixelRatio).toBe(1);
  });

  it.each([
    [0, 1],
    [NaN, 1],
    [-2, 1],
    [2.4, 2],
  ])('M7: wickWidth %p → %p px', (wick, px) => {
    // Given / When / Then
    expect(metrics(20, 1, 0.8, wick).wickWidthPx).toBe(px);
  });

  it('M8: writes into and returns `out`', () => {
    // Given
    const out = createCandleMetrics();
    // When / Then
    expect(computeCandleMetrics(10, 0.8, 1, 1, out)).toBe(out);
  });
});
