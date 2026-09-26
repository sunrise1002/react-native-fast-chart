/**
 * Test perspective table — PriceFormat
 *
 * | Case | Input / Precondition                                | Perspective          | Expected                                   |
 * |------|-----------------------------------------------------|----------------------|--------------------------------------------|
 * | PF1  | sanitizeDecimals 2.4 / -1 / 99 / NaN / ∞            | Boundary / invalid   | 2 / 0 / 12 / fallback / fallback           |
 * | PF2  | stepDecimals 100 / 2.5 / 0.25 / 5e-8 / 0.1+0.2      | Equivalence          | 0 / 1 / 2 / 8 / 17-digit float → 1         |
 * | PF3  | stepDecimals 0 / -1 / NaN / ∞ / 1e-15               | Boundary / invalid   | 0 / 0 / 0 / 0 / capped at 12               |
 * | PF4  | autoPriceDecimals 65000 / 1 / 0.5 / 0.00001234      | Equivalence          | 2 / 2 / 4 / 8                              |
 * | PF5  | autoPriceDecimals 0 / NaN / ∞ / -0.05 / 1e-30       | Boundary / invalid   | 2 / 2 / 2 / 5 (abs) / capped 12            |
 * | PF6  | displayDecimals precision 4 / 0 / NaN / -1          | Equivalence          | 4 / 0 / auto / auto                        |
 * | PF7  | formatPrice grouping 65432.1 / 1234567 / 999 / 1000 | Equivalence/Boundary | "65,432.10" / "1,234,567" / "999" / "1,000"|
 * | PF8  | formatPrice custom sep ' ' / '' / micro price       | Equivalence          | "1 000.00" / "1000.00" / "0.00001234"      |
 * | PF9  | formatPrice NaN / ±∞                                | Invalid              | ''                                         |
 * | PF10 | formatPrice -0.001 (2 dp) / -0 / -1234.5            | Boundary             | "0.00" / "0.00" / "-1,234.50"               |
 * | PF11 | formatPrice ≥ 1e21 / ≤ -1e21                        | Boundary             | exponent notation                          |
 * | PF12 | formatPrice decimals NaN / 20                       | Invalid              | fallback 2 / capped 12                     |
 * | PF13 | formatSignedPrice +12.3 / -0.5 / 0 / NaN / 0.001    | Equivalence/Boundary | "+12.30" / "-0.50" / "0.00" / '' / "0.00"  |
 * | PF14 | formatPercent 1.234 / -0.5 / 0 / NaN                | Equivalence/invalid  | "+1.23%" / "-0.50%" / "0.00%" / ''         |
 * | PF15 | formatVolume 950 / 1234 / 12_345_678 / 999.999 / 1e15| Equivalence/Boundary| "950" / "1.23K" / "12.35M" / "1.00K" / T  |
 * | PF16 | formatVolume 0 / 0.5 / 0.00123 / 12.5               | Boundary             | "0" / "0.5000" / "0.001230" / "12.50"      |
 * | PF17 | formatVolume -1 / NaN / ∞                           | Invalid              | ''                                         |
 * | PF18 | formatVolume precision 3 on 12.3456 / 0.5 / 0       | Equivalence/Boundary | "12.346" / "0.500" / "0.000"               |
 * | PF19 | formatVolume precision 0 / 20 / 4 (999.4, 1.5, 1234) | Boundary            | "999" / clamped 12 decimals / "1.23K"      |
 * | PF20 | formatVolume precision -1 / NaN                     | Invalid              | automatic format                           |
 */
import { describe, expect, it } from '@jest/globals';
import {
  autoPriceDecimals,
  displayDecimals,
  formatPercent,
  formatPrice,
  formatSignedPrice,
  formatVolume,
  MAX_PRICE_DECIMALS,
  sanitizeDecimals,
  stepDecimals,
} from '../PriceFormat';

describe('sanitizeDecimals', () => {
  it.each([
    [2.4, 2],
    [2.5, 3],
    [0, 0],
    [-1, 0],
    [12, 12],
    [13, MAX_PRICE_DECIMALS],
    [99, MAX_PRICE_DECIMALS],
  ])('PF1: %p → %p', (value, expected) => {
    // Given / When / Then
    expect(sanitizeDecimals(value)).toBe(expected);
  });

  it.each([[NaN], [Infinity], [-Infinity]])('PF1: %p → fallback', (value) => {
    // Given / When / Then
    expect(sanitizeDecimals(value)).toBe(2);
    expect(sanitizeDecimals(value, 5)).toBe(5);
  });
});

describe('stepDecimals', () => {
  it.each([
    [100, 0],
    [1, 0],
    [2.5, 1],
    [0.25, 2],
    [5e-8, 8],
    [0.1 + 0.2, 1],
  ])('PF2: step %p → %p decimals', (step, expected) => {
    // Given / When / Then
    expect(stepDecimals(step)).toBe(expected);
  });

  it.each([
    [0, 0],
    [-1, 0],
    [NaN, 0],
    [Infinity, 0],
    [1e-15, MAX_PRICE_DECIMALS],
  ])('PF3: step %p → %p', (step, expected) => {
    // Given / When / Then
    expect(stepDecimals(step)).toBe(expected);
  });
});

describe('autoPriceDecimals', () => {
  it.each([
    [65000, 2],
    [1, 2],
    [0.5, 4],
    [0.00001234, 8],
  ])('PF4: %p → %p', (price, expected) => {
    // Given / When / Then
    expect(autoPriceDecimals(price)).toBe(expected);
  });

  it.each([
    [0, 2],
    [NaN, 2],
    [Infinity, 2],
    [-0.05, 5],
    [1e-30, MAX_PRICE_DECIMALS],
  ])('PF5: %p → %p', (price, expected) => {
    // Given / When / Then
    expect(autoPriceDecimals(price)).toBe(expected);
  });
});

describe('displayDecimals', () => {
  it.each([
    [4, 100, 4],
    [0, 0.001, 0],
    [NaN, 0.00001234, 8],
    [-1, 100, 2],
  ])('PF6: precision %p, reference %p → %p', (precision, ref, expected) => {
    // Given / When / Then
    expect(displayDecimals(precision, ref)).toBe(expected);
  });
});

describe('formatPrice', () => {
  it.each([
    [65432.1, 2, '65,432.10'],
    [1234567, 0, '1,234,567'],
    [999, 0, '999'],
    [1000, 0, '1,000'],
    [123456.789, 1, '123,456.8'],
  ])('PF7: %p (%p dp) → %p', (value, decimals, expected) => {
    // Given / When / Then
    expect(formatPrice(value, decimals)).toBe(expected);
  });

  it('PF8: honors the separator and micro prices', () => {
    // Given / When / Then
    expect(formatPrice(1000, 2, ' ')).toBe('1 000.00');
    expect(formatPrice(1000, 2, '')).toBe('1000.00');
    expect(formatPrice(0.00001234, 8)).toBe('0.00001234');
  });

  it.each([[NaN], [Infinity], [-Infinity]])('PF9: %p → empty', (value) => {
    // Given / When / Then
    expect(formatPrice(value, 2)).toBe('');
  });

  it.each([
    [-0.001, '0.00'],
    [-0, '0.00'],
    [-1234.5, '-1,234.50'],
  ])('PF10: %p → %p (no negative zero)', (value, expected) => {
    // Given / When / Then
    expect(formatPrice(value, 2)).toBe(expected);
  });

  it('PF11: uses exponent notation from 1e21', () => {
    // Given / When / Then
    expect(formatPrice(1e21, 2)).toBe('1.00e+21');
    expect(formatPrice(-2.5e22, 2)).toBe('-2.50e+22');
  });

  it('PF12: sanitizes the decimals', () => {
    // Given / When / Then
    expect(formatPrice(1.5, NaN)).toBe('1.50');
    expect(formatPrice(1, 20)).toBe('1.000000000000');
  });
});

describe('formatSignedPrice', () => {
  it.each([
    [12.3, '+12.30'],
    [-0.5, '-0.50'],
    [0, '0.00'],
    [0.001, '0.00'],
    [NaN, ''],
  ])('PF13: %p → %p', (value, expected) => {
    // Given / When / Then
    expect(formatSignedPrice(value, 2)).toBe(expected);
  });
});

describe('formatPercent', () => {
  it.each([
    [1.234, '+1.23%'],
    [-0.5, '-0.50%'],
    [0, '0.00%'],
    [12345, '+12345.00%'],
    [NaN, ''],
  ])('PF14: %p → %p', (value, expected) => {
    // Given / When / Then
    expect(formatPercent(value)).toBe(expected);
  });
});

describe('formatVolume', () => {
  it.each([
    [950, '950'],
    [1234, '1.23K'],
    [12_345_678, '12.35M'],
    [999.999, '1.00K'],
    [2.5e9, '2.50B'],
    [1e15, '1,000.00T'],
  ])('PF15: %p → %p', (value, expected) => {
    // Given / When / Then
    expect(formatVolume(value)).toBe(expected);
  });

  it.each([
    [0, '0'],
    [0.5, '0.5000'],
    [0.00123, '0.001230'],
    [12.5, '12.50'],
  ])('PF16: %p → %p', (value, expected) => {
    // Given / When / Then
    expect(formatVolume(value)).toBe(expected);
  });

  it.each([[-1], [NaN], [Infinity]])('PF17: %p → empty', (value) => {
    // Given / When / Then
    expect(formatVolume(value)).toBe('');
  });
});

describe('formatVolume precision', () => {
  it.each([
    [12.3456, '12.346'],
    [0.5, '0.500'],
    [0, '0.000'],
  ])('PF18: %p with 3 decimals → %p', (value, expected) => {
    // Given / When / Then
    expect(formatVolume(value, 3)).toBe(expected);
  });

  it('PF19: 0 / over-max decimals, scaled units keep 2', () => {
    // Given / When / Then
    expect(formatVolume(999.4, 0)).toBe('999');
    expect(formatVolume(1.5, 20)).toBe('1.' + '5'.padEnd(12, '0'));
    expect(formatVolume(1234, 4)).toBe('1.23K');
  });

  it.each([[-1], [NaN]])('PF20: precision %p → automatic', (precision) => {
    // Given / When / Then
    expect(formatVolume(0.5, precision)).toBe('0.5000');
    expect(formatVolume(950, precision)).toBe('950');
  });
});
