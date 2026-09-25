/**
 * Test perspective table — TimeFormat
 *
 * | Case | Input / Precondition                                  | Perspective        | Expected                             |
 * |------|-------------------------------------------------------|--------------------|--------------------------------------|
 * | TF1  | formatClock 14:05:09 with / without seconds           | Equivalence        | "14:05:09" / "14:05"                 |
 * | TF2  | formatClock midnight / 23:59:59.999 / pre-epoch       | Boundary           | "00:00" / "23:59:59" / wraps         |
 * | TF3  | formatClock NaN / ∞                                   | Invalid            | ''                                   |
 * | TF4  | formatTimeTick weight year / month / day / time       | Equivalence        | "2024" / "Mar" / "15" / "14:05"      |
 * | TF5  | formatTimeTick weight 0 / 9                           | Boundary           | clock / year                         |
 * | TF6  | formatTimeTick NaN                                    | Invalid            | ''                                   |
 * | TF7  | formatDateTime 1d / 1h / 1s bars                      | Equivalence        | date / + HH:mm / + HH:mm:ss          |
 * | TF8  | formatDateTime bar 0 / NaN / 1 min                    | Boundary           | minutes (no seconds)                 |
 * | TF9  | formatDateTime NaN time                               | Invalid            | ''                                   |
 * | TF10 | MONTH_NAMES                                           | Equivalence        | 12 English abbreviations             |
 */
import { describe, expect, it } from '@jest/globals';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../CivilTime';
import {
  formatClock,
  formatDateTime,
  formatTimeTick,
  MONTH_NAMES,
  TICK_WEIGHT_DAY,
  TICK_WEIGHT_MONTH,
  TICK_WEIGHT_TIME,
  TICK_WEIGHT_YEAR,
} from '../TimeFormat';

const T = Date.UTC(2024, 2, 15, 14, 5, 9);

describe('formatClock', () => {
  it('TF1: formats hours, minutes and optional seconds', () => {
    // Given / When / Then
    expect(formatClock(T, true)).toBe('14:05:09');
    expect(formatClock(T, false)).toBe('14:05');
  });

  it.each([
    [Date.UTC(2024, 0, 1), true, '00:00:00'],
    [Date.UTC(2024, 0, 1) - 1, true, '23:59:59'],
    [-MS_PER_HOUR, false, '23:00'],
  ])('TF2: %p → %p', (ms, seconds, expected) => {
    // Given / When / Then
    expect(formatClock(ms, seconds)).toBe(expected);
  });

  it.each([[NaN], [Infinity]])('TF3: %p → empty', (ms) => {
    // Given / When / Then
    expect(formatClock(ms, false)).toBe('');
  });
});

describe('formatTimeTick', () => {
  it.each([
    [TICK_WEIGHT_YEAR, '2024'],
    [TICK_WEIGHT_MONTH, 'Mar'],
    [TICK_WEIGHT_DAY, '15'],
    [TICK_WEIGHT_TIME, '14:05'],
    [0, '14:05'],
    [9, '2024'],
  ])('TF4/TF5: weight %p → %p', (weight, expected) => {
    // Given / When / Then
    expect(formatTimeTick(T, weight, false)).toBe(expected);
  });

  it('TF6: NaN → empty', () => {
    // Given / When / Then
    expect(formatTimeTick(NaN, TICK_WEIGHT_YEAR, false)).toBe('');
  });
});

describe('formatDateTime', () => {
  it.each([
    [MS_PER_DAY, '2024-03-15'],
    [7 * MS_PER_DAY, '2024-03-15'],
    [MS_PER_HOUR, '2024-03-15 14:05'],
    [1000, '2024-03-15 14:05:09'],
    [MS_PER_MINUTE, '2024-03-15 14:05'],
    [0, '2024-03-15 14:05'],
    [NaN, '2024-03-15 14:05'],
  ])('TF7/TF8: bar %p ms → %p', (barMs, expected) => {
    // Given / When / Then
    expect(formatDateTime(T, barMs)).toBe(expected);
  });

  it('TF7: pads single-digit months and days', () => {
    // Given / When / Then
    expect(formatDateTime(Date.UTC(2024, 0, 5), MS_PER_DAY)).toBe('2024-01-05');
  });

  it('TF9: NaN time → empty', () => {
    // Given / When / Then
    expect(formatDateTime(NaN, MS_PER_DAY)).toBe('');
  });
});

it('TF10: month names', () => {
  // Given / When / Then
  expect(MONTH_NAMES).toHaveLength(12);
  expect(MONTH_NAMES[0]).toBe('Jan');
  expect(MONTH_NAMES[11]).toBe('Dec');
});
