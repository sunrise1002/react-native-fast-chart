/**
 * Test perspective table — TextMetrics / AxisWidth
 *
 * | Case | Input / Precondition                                  | Perspective        | Expected                                  |
 * |------|-------------------------------------------------------|--------------------|-------------------------------------------|
 * | TM1  | measuredCharacters                                    | Equivalence        | ' ' … '~', 95 chars                       |
 * | TM2  | table from widths; measure "1.5"                      | Equivalence        | sum of glyph widths                       |
 * | TM3  | invalid widths (NaN / -1 / ∞ / missing)               | Invalid            | 0, fallback = widest valid                |
 * | TM4  | non-ASCII / control characters                        | Boundary           | fallback width                            |
 * | TM5  | empty string                                          | Boundary (empty)   | 0                                         |
 * | AW1  | requiredAxisWidth 50 + 2×6 → 62 → quantum 4           | Equivalence        | 64                                        |
 * | AW2  | exact multiple / label 0 / quantum 1                  | Boundary           | unchanged / 2×pad / exact                 |
 * | AW3  | invalid label / padding / quantum                     | Invalid            | treated as 0 / 0 / 1                      |
 * | AW4  | nextAxisWidth grow / keep (no shrink) / shrink        | Equivalence        | required / current / required             |
 * | AW5  | below min / above max / max < min                     | Boundary           | min / max / max ignored                   |
 * | AW6  | required NaN / current ∞ / min NaN                    | Invalid            | min / required / 0 floor                  |
 */
import { describe, expect, it } from '@jest/globals';
import { nextAxisWidth, requiredAxisWidth } from '../AxisWidth';
import {
  createGlyphWidthTable,
  FIRST_MEASURED_CHAR,
  LAST_MEASURED_CHAR,
  measuredCharacters,
  measureText,
} from '../TextMetrics';

const code = (c: string) => c.charCodeAt(0) - FIRST_MEASURED_CHAR;

describe('TextMetrics', () => {
  it('TM1: lists printable ASCII', () => {
    // Given / When
    const chars = measuredCharacters();
    // Then
    expect(chars).toHaveLength(LAST_MEASURED_CHAR - FIRST_MEASURED_CHAR + 1);
    expect(chars[0]).toBe(' ');
    expect(chars[chars.length - 1]).toBe('~');
  });

  it('TM2: sums glyph widths', () => {
    // Given
    const widths = new Array<number>(95).fill(5);
    widths[code('.')] = 2;
    const table = createGlyphWidthTable(widths);
    // When / Then
    expect(measureText(table, '1.5')).toBe(12);
  });

  it('TM3: invalid widths count as 0; fallback is the widest', () => {
    // Given
    const widths: number[] = [];
    widths[code('A')] = NaN;
    widths[code('B')] = -1;
    widths[code('C')] = Infinity;
    widths[code('D')] = 9;
    // When
    const table = createGlyphWidthTable(widths);
    // Then
    expect(measureText(table, 'ABCE')).toBe(0);
    expect(measureText(table, 'D')).toBe(9);
    expect(table.fallback).toBe(9);
  });

  it('TM4: non-ASCII and control characters use the fallback', () => {
    // Given
    const table = createGlyphWidthTable(new Array<number>(95).fill(4));
    // When / Then
    expect(measureText(table, '€\n')).toBe(8);
  });

  it('TM5: empty string', () => {
    // Given / When / Then
    expect(measureText(createGlyphWidthTable([]), '')).toBe(0);
  });
});

describe('requiredAxisWidth', () => {
  it.each([
    [50, 6, 4, 64],
    [52, 6, 4, 64],
    [0, 6, 4, 12],
    [50.5, 6, 1, 63],
  ])('AW1/AW2: label %p, pad %p, q %p → %p', (label, pad, q, expected) => {
    // Given / When / Then
    expect(requiredAxisWidth(label, pad, q)).toBe(expected);
  });

  it.each([
    [NaN, 6, 4, 12],
    [Infinity, 6, 4, 12],
    [50, NaN, 4, 52],
    [50, -3, 4, 52],
    [50, 6, 0, 62],
    [50, 6, NaN, 62],
  ])('AW3: label %p, pad %p, q %p → %p', (label, pad, q, expected) => {
    // Given / When / Then
    expect(requiredAxisWidth(label, pad, q)).toBe(expected);
  });
});

describe('nextAxisWidth', () => {
  it.each([
    [64, 80, false, 80],
    [80, 64, false, 80],
    [80, 64, true, 64],
  ])(
    'AW4: current %p, required %p, shrink %p → %p',
    (cur, req, s, expected) => {
      // Given / When / Then
      expect(nextAxisWidth(cur, req, 40, 200, s)).toBe(expected);
    }
  );

  it.each([
    [0, 30, 40, 200, 40],
    [0, 300, 40, 200, 200],
    [0, 300, 40, 20, 300],
  ])(
    'AW5: required %p (min %p, max %p) → %p',
    (cur, req, min, max, expected) => {
      // Given / When / Then
      expect(nextAxisWidth(cur, req, min, max, false)).toBe(expected);
    }
  );

  it.each([
    [0, NaN, 40, 40],
    [Infinity, 50, 40, 50],
    [0, 50, NaN, 50],
    [0, NaN, NaN, 0],
  ])('AW6: current %p, required %p, min %p → %p', (cur, req, min, expected) => {
    // Given / When / Then
    expect(nextAxisWidth(cur, req, min, 200, false)).toBe(expected);
  });
});
