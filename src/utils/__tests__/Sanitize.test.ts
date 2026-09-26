/**
 * Test perspective table — Sanitize (numeric guards before Skia)
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                  |
 * |------|--------------------------------------------------------|--------------------|-------------------------------------------|
 * | SZ1  | isFiniteNumber 0 / -1.5 / 1e308                        | Equivalence / max  | true                                      |
 * | SZ2  | isFiniteNumber NaN / ±∞ / '1' / null / undefined       | Invalid            | false                                     |
 * | SZ3  | finiteOr finite / NaN / ∞                              | Equivalence / inv. | value / fallback / fallback               |
 * | SZ4  | clampCoordinate 0 / ±MAX / ±(MAX+1) / 1e300            | Boundary (±1)      | kept / clamped                            |
 * | SZ5  | clampCoordinate NaN / ±∞                               | Invalid            | NaN                                       |
 * | SZ6  | clampFinite inside / below / above / at bounds         | Boundary           | value / min / max / bound                 |
 * | SZ7  | clampFinite NaN / ∞                                    | Invalid            | fallback                                  |
 * | SZ8  | sanitizeLength 0 / 12.5 / -0.1 / NaN / ∞ (default fb)  | Boundary / invalid | 0 / 12.5 / 0 / 0 / 0                       |
 * | SZ9  | sanitizeLength custom fallback                         | Equivalence        | fallback                                  |
 * | SR1  | sanitizeRect normal rect                               | Equivalence        | true, untouched                           |
 * | SR2  | sanitizeRect negative width / height                   | Boundary           | true, size 0                              |
 * | SR3  | sanitizeRect huge origin / far edge                    | Boundary (max)     | clamped into ±MAX                         |
 * | SR4  | sanitizeRect NaN / ∞ in any field                      | Invalid            | false, untouched                          |
 */
import { describe, expect, it } from '@jest/globals';
import {
  clampCoordinate,
  clampFinite,
  finiteOr,
  isFiniteNumber,
  MAX_ABS_COORDINATE,
  sanitizeLength,
  sanitizeRect,
  type MutableRect,
} from '../Sanitize';

const MAX = MAX_ABS_COORDINATE;

describe('Sanitize', () => {
  it.each([[0], [-1.5], [1e308]])('SZ1: isFiniteNumber(%p) → true', (v) => {
    // Given / When / Then
    expect(isFiniteNumber(v)).toBe(true);
  });

  it.each([[NaN], [Infinity], [-Infinity], ['1'], [null], [undefined]])(
    'SZ2: isFiniteNumber(%p) → false',
    (v) => {
      // Given / When / Then
      expect(isFiniteNumber(v)).toBe(false);
    }
  );

  it.each([
    [3, 3],
    [NaN, 7],
    [Infinity, 7],
  ])('SZ3: finiteOr(%p, 7) → %p', (v, expected) => {
    // Given / When / Then
    expect(finiteOr(v, 7)).toBe(expected);
  });

  it.each([
    [0, 0],
    [MAX, MAX],
    [-MAX, -MAX],
    [MAX + 1, MAX],
    [-MAX - 1, -MAX],
    [1e300, MAX],
  ])('SZ4: clampCoordinate(%p) → %p', (v, expected) => {
    // Given / When / Then
    expect(clampCoordinate(v)).toBe(expected);
  });

  it.each([[NaN], [Infinity], [-Infinity]])(
    'SZ5: clampCoordinate(%p) → NaN',
    (v) => {
      // Given / When / Then
      expect(clampCoordinate(v)).toBeNaN();
    }
  );

  it.each([
    [5, 5],
    [-1, 0],
    [11, 10],
    [0, 0],
    [10, 10],
  ])('SZ6: clampFinite(%p, 0, 10) → %p', (v, expected) => {
    // Given / When / Then
    expect(clampFinite(v, 0, 10, 99)).toBe(expected);
  });

  it.each([[NaN], [Infinity]])('SZ7: clampFinite(%p) → fallback', (v) => {
    // Given / When / Then
    expect(clampFinite(v, 0, 10, 99)).toBe(99);
  });

  it.each([
    [0, 0],
    [12.5, 12.5],
    [-0.1, 0],
    [NaN, 0],
    [Infinity, 0],
  ])('SZ8: sanitizeLength(%p) → %p', (v, expected) => {
    // Given / When / Then
    expect(sanitizeLength(v)).toBe(expected);
  });

  it('SZ9: sanitizeLength custom fallback', () => {
    // Given / When / Then
    expect(sanitizeLength(NaN, 4)).toBe(4);
  });
});

describe('sanitizeRect', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
  });

  it('SR1: keeps a normal rect', () => {
    // Given
    const r = rect(10, 20, 30, 40);
    // When / Then
    expect(sanitizeRect(r)).toBe(true);
    expect(r).toEqual(rect(10, 20, 30, 40));
  });

  it('SR2: negative sizes become 0', () => {
    // Given
    const r = rect(10, 20, -5, -1);
    // When / Then
    expect(sanitizeRect(r)).toBe(true);
    expect(r).toEqual(rect(10, 20, 0, 0));
  });

  it('SR3: clamps origin and far edge', () => {
    // Given
    const r = rect(-1e9, 0, 3e9, 1e12);
    // When
    sanitizeRect(r);
    // Then
    expect(r).toEqual(rect(-MAX, 0, 2 * MAX, MAX));
  });

  it.each<keyof MutableRect>(['x', 'y', 'width', 'height'])(
    'SR4: non-finite %s → false, untouched',
    (key) => {
      // Given
      const r = rect(1, 2, 3, 4);
      r[key] = key === 'x' ? NaN : Infinity;
      const copy = { ...r };
      // When / Then
      expect(sanitizeRect(r)).toBe(false);
      expect(r).toEqual(copy);
    }
  );
});
