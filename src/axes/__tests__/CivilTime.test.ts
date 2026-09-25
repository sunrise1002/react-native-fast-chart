/**
 * Test perspective table — CivilTime
 *
 * | Case | Input / Precondition                                  | Perspective        | Expected                             |
 * |------|-------------------------------------------------------|--------------------|--------------------------------------|
 * | CT1  | known dates (epoch, leap day, end of year, 2024-03-15)| Equivalence        | matches Date.UTC                     |
 * | CT2  | pre-epoch dates (1969-12-31, 1900-03-01)              | Boundary (neg.)    | matches Date.UTC                     |
 * | CT3  | round trip over ±200 years, every 97 days             | Equivalence        | days → civil → days identity         |
 * | CT4  | fractional days                                       | Boundary           | floored                              |
 * | CT5  | daysOf / msOfDay at 0, -1 ms, one day - 1 ms          | Boundary (±1)      | floor / wrap into [0, 1 day)         |
 * | CT6  | createCivilDate                                       | Equivalence        | 1970-01-01                           |
 */
import { describe, expect, it } from '@jest/globals';
import {
  civilFromDays,
  createCivilDate,
  daysFromCivil,
  daysOf,
  MS_PER_DAY,
  msOfDay,
} from '../CivilTime';

const utcDays = (y: number, m: number, d: number) =>
  Date.UTC(y, m - 1, d) / MS_PER_DAY;

describe('civil dates', () => {
  it.each([
    [1970, 1, 1],
    [2000, 2, 29],
    [2023, 12, 31],
    [2024, 3, 15],
    [2100, 3, 1],
  ])('CT1: %p-%p-%p', (y, m, d) => {
    // Given
    const days = utcDays(y, m, d);
    // When
    const date = civilFromDays(days, createCivilDate());
    // Then
    expect(daysFromCivil(y, m, d)).toBe(days);
    expect(date).toEqual({ year: y, month: m, day: d });
  });

  it.each([
    [1969, 12, 31],
    [1900, 3, 1],
    [1600, 1, 1],
  ])('CT2: pre-epoch %p-%p-%p', (y, m, d) => {
    // Given
    const days = utcDays(y, m, d);
    // When / Then
    expect(daysFromCivil(y, m, d)).toBe(days);
    expect(civilFromDays(days, createCivilDate())).toEqual({
      year: y,
      month: m,
      day: d,
    });
  });

  it('CT3: round-trips over four centuries', () => {
    // Given
    const out = createCivilDate();
    // When / Then
    for (let days = -73000; days <= 73000; days += 97) {
      civilFromDays(days, out);
      expect(daysFromCivil(out.year, out.month, out.day)).toBe(days);
    }
  });

  it('CT4: floors fractional days', () => {
    // Given / When / Then
    expect(civilFromDays(0.99, createCivilDate())).toEqual({
      year: 1970,
      month: 1,
      day: 1,
    });
    expect(civilFromDays(-0.5, createCivilDate()).day).toBe(31);
  });

  it('CT6: creates the epoch date', () => {
    // Given / When / Then
    expect(createCivilDate()).toEqual({ year: 1970, month: 1, day: 1 });
  });
});

describe('daysOf / msOfDay', () => {
  it.each([
    [0, 0, 0],
    [-1, -1, MS_PER_DAY - 1],
    [MS_PER_DAY - 1, 0, MS_PER_DAY - 1],
    [MS_PER_DAY, 1, 0],
    [-MS_PER_DAY, -1, 0],
  ])('CT5: %p ms → day %p, ms-of-day %p', (ms, day, of) => {
    // Given / When / Then
    expect(daysOf(ms)).toBe(day);
    expect(msOfDay(ms) + 0).toBe(of);
  });
});
