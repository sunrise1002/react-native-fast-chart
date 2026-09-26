/**
 * Test perspective table — Formatters (custom label hooks)
 *
 * | Case | Input / Precondition                                 | Perspective       | Expected                                  |
 * |------|------------------------------------------------------|-------------------|-------------------------------------------|
 * | PF1  | price formatter returns a string                     | Equivalence       | its text, called with (value, decimals)   |
 * | PF2  | no formatter                                         | Boundary (NULL)   | formatPrice(value, decimals, separator)   |
 * | PF3  | formatter throws                                     | Abnormal          | built-in format                           |
 * | PF4  | formatter returns a number / undefined               | Invalid type      | built-in format                           |
 * | PF5  | value NaN / ∞                                        | Invalid           | formatter not called, built-in text       |
 * | PF6  | formatter returns ''                                 | Boundary (empty)  | '' kept (valid string)                    |
 * | TF1  | time formatter, tick weight                          | Equivalence       | its text, called with (t, weight, barMs)  |
 * | TF2  | no formatter, tick weight / crosshair weight         | Boundary (NULL)   | formatTimeTick / formatDateTime           |
 * | TF3  | time formatter throws                                | Abnormal          | built-in format                           |
 * | TF4  | time formatter returns non-string                    | Invalid type      | built-in format                           |
 * | TF5  | localTime NaN                                        | Invalid           | formatter not called                      |
 * | TF6  | withSeconds flag                                     | Equivalence       | forwarded to formatTimeTick               |
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  applyPriceFormatter,
  applyTimeFormatter,
  TIME_LABEL_CROSSHAIR,
  type PriceFormatter,
  type TimeFormatter,
} from '../Formatters';
import { formatPrice } from '../PriceFormat';
import {
  formatDateTime,
  formatTimeTick,
  TICK_WEIGHT_DAY,
  TICK_WEIGHT_TIME,
} from '../TimeFormat';

const T = Date.UTC(2024, 2, 5, 13, 45, 30);
const MINUTE = 60_000;

describe('applyPriceFormatter', () => {
  it('PF1: uses the formatter text', () => {
    // Given
    const fmt = jest.fn<PriceFormatter>((p, d) => `$${p.toFixed(d)}`);
    // When
    const out = applyPriceFormatter(fmt, 1234.5, 2, ',');
    // Then
    expect(out).toBe('$1234.50');
    expect(fmt).toHaveBeenCalledWith(1234.5, 2);
  });

  it('PF2: falls back to formatPrice without a formatter', () => {
    // Given / When / Then
    expect(applyPriceFormatter(undefined, 1234.5, 2, ',')).toBe(
      formatPrice(1234.5, 2, ',')
    );
  });

  it('PF3: a throwing formatter falls back', () => {
    // Given
    const fmt: PriceFormatter = () => {
      throw new Error('boom');
    };
    // When / Then
    expect(applyPriceFormatter(fmt, 1.5, 1, '')).toBe(formatPrice(1.5, 1, ''));
  });

  it.each([[42], [undefined], [null]])(
    'PF4: a non-string result %p falls back',
    (result) => {
      // Given
      const fmt = (() => result) as unknown as PriceFormatter;
      // When / Then
      expect(applyPriceFormatter(fmt, 1.5, 1, '')).toBe('1.5');
    }
  );

  it.each([[NaN], [Infinity]])('PF5: value %p skips the formatter', (value) => {
    // Given
    const fmt = jest.fn<PriceFormatter>(() => 'x');
    // When
    const out = applyPriceFormatter(fmt, value, 2, '');
    // Then
    expect(fmt).not.toHaveBeenCalled();
    expect(out).toBe(formatPrice(value, 2, ''));
  });

  it('PF6: an empty string is a valid result', () => {
    // Given / When / Then
    expect(applyPriceFormatter(() => '', 1, 2, '')).toBe('');
  });
});

describe('applyTimeFormatter', () => {
  it('TF1: uses the formatter text', () => {
    // Given
    const fmt = jest.fn<TimeFormatter>(() => 'custom');
    // When
    const out = applyTimeFormatter(fmt, T, TICK_WEIGHT_DAY, MINUTE, false);
    // Then
    expect(out).toBe('custom');
    expect(fmt).toHaveBeenCalledWith(T, TICK_WEIGHT_DAY, MINUTE);
  });

  it('TF2: built-in tick and crosshair formats without a formatter', () => {
    // Given / When / Then
    expect(
      applyTimeFormatter(undefined, T, TICK_WEIGHT_TIME, MINUTE, false)
    ).toBe(formatTimeTick(T, TICK_WEIGHT_TIME, false));
    expect(
      applyTimeFormatter(undefined, T, TIME_LABEL_CROSSHAIR, MINUTE, false)
    ).toBe(formatDateTime(T, MINUTE));
  });

  it('TF3: a throwing formatter falls back', () => {
    // Given
    const fmt: TimeFormatter = () => {
      throw new TypeError('not a worklet');
    };
    // When / Then
    expect(
      applyTimeFormatter(fmt, T, TIME_LABEL_CROSSHAIR, MINUTE, false)
    ).toBe(formatDateTime(T, MINUTE));
  });

  it('TF4: a non-string result falls back', () => {
    // Given
    const fmt = (() => 7) as unknown as TimeFormatter;
    // When / Then
    expect(applyTimeFormatter(fmt, T, TICK_WEIGHT_DAY, MINUTE, false)).toBe(
      formatTimeTick(T, TICK_WEIGHT_DAY, false)
    );
  });

  it('TF5: a NaN time skips the formatter', () => {
    // Given
    const fmt = jest.fn<TimeFormatter>(() => 'x');
    // When
    applyTimeFormatter(fmt, NaN, TICK_WEIGHT_DAY, MINUTE, false);
    // Then
    expect(fmt).not.toHaveBeenCalled();
  });

  it('TF6: forwards withSeconds to the built-in tick format', () => {
    // Given / When / Then
    expect(applyTimeFormatter(undefined, T, TICK_WEIGHT_TIME, 1000, true)).toBe(
      formatTimeTick(T, TICK_WEIGHT_TIME, true)
    );
  });
});
