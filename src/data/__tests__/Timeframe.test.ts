/**
 * Test perspective table — timeframe parsing & UTC bucket alignment
 *
 * | Case | Input / Precondition                           | Perspective        | Expected                              |
 * |------|------------------------------------------------|--------------------|---------------------------------------|
 * | P1   | '1s','1m','5m','15m','1h','4h','1d','1w','1M'  | Equivalence        | unit/count/ms                         |
 * | P2   | '', '0m', 'm', '1x', '1.5m', '-1m', ' 1m', '1H', 7 digits, non-string | Invalid | null               |
 * | P3   | '999999m' (max digits)                         | Boundary (max)     | parsed                                |
 * | T1   | timeframeToMs valid / invalid                  | Equiv. / Abnormal  | ms / RangeError with message          |
 * | A1   | minute: inside / exact boundary / boundary-1   | Boundary (±1)      | floor to minute                       |
 * | A2   | 4h and 1d                                      | Equivalence        | UTC multiples                         |
 * | A3   | 1w: Monday, Sunday, epoch (Thursday)           | Boundary           | Monday 00:00 UTC                      |
 * | A4   | 1M / 3M mid-month                              | Equivalence        | first of (quarter) month              |
 * | A5   | NaN / Infinity time                            | Abnormal           | NaN                                   |
 * | N1   | next bucket: minute, Dec → Jan, 3M             | Equiv. / Boundary  | correct next open                     |
 */
import { describe, expect, it } from '@jest/globals';
import {
  getBucketStart,
  getNextBucketStart,
  parseTimeframe,
  timeframeToMs,
  type TimeframeSpec,
} from '../Timeframe';

const spec = (tf: string) => parseTimeframe(tf) as TimeframeSpec;
const utc = Date.UTC;

describe('parseTimeframe', () => {
  it.each([
    ['1s', 's', 1, 1_000],
    ['1m', 'm', 1, 60_000],
    ['5m', 'm', 5, 300_000],
    ['15m', 'm', 15, 900_000],
    ['1h', 'h', 1, 3_600_000],
    ['4h', 'h', 4, 14_400_000],
    ['1d', 'd', 1, 86_400_000],
    ['1w', 'w', 1, 604_800_000],
    ['1M', 'M', 1, 2_592_000_000],
  ])('P1: %p', (tf, unit, count, ms) => {
    // Given / When
    const parsed = parseTimeframe(tf);
    // Then
    expect(parsed).toEqual({ unit, count, ms });
  });

  it.each(['', '0m', 'm', '1x', '1.5m', '-1m', ' 1m', '1H', '1000000m'])(
    'P2: rejects %p',
    (tf) => {
      // Given / When / Then
      expect(parseTimeframe(tf)).toBeNull();
    }
  );

  it('P2: rejects non-strings', () => {
    // Given / When / Then
    expect(parseTimeframe(60 as unknown as string)).toBeNull();
    expect(parseTimeframe(null as unknown as string)).toBeNull();
  });

  it('P3: accepts the largest count', () => {
    // Given / When / Then
    expect(parseTimeframe('999999m')?.count).toBe(999_999);
  });
});

describe('timeframeToMs', () => {
  it('T1: converts or throws', () => {
    // Given / When / Then
    expect(timeframeToMs('15m')).toBe(900_000);
    expect(() => timeframeToMs('abc')).toThrow(RangeError);
    expect(() => timeframeToMs('abc')).toThrow('Invalid timeframe: abc');
  });
});

describe('getBucketStart', () => {
  it('A1: minute alignment around the boundary', () => {
    // Given
    const m = spec('1m');
    const boundary = utc(2024, 0, 1, 10, 5);
    // When / Then
    expect(getBucketStart(boundary + 59_999, m)).toBe(boundary);
    expect(getBucketStart(boundary, m)).toBe(boundary);
    expect(getBucketStart(boundary - 1, m)).toBe(boundary - 60_000);
  });

  it('A2: 4h and 1d buckets are UTC aligned', () => {
    // Given
    const t = utc(2024, 2, 10, 13, 37, 12);
    // When / Then
    expect(getBucketStart(t, spec('4h'))).toBe(utc(2024, 2, 10, 12));
    expect(getBucketStart(t, spec('1d'))).toBe(utc(2024, 2, 10));
  });

  it('A3: weeks start on Monday 00:00 UTC', () => {
    // Given: 2024-01-01 is a Monday
    const w = spec('1w');
    const monday = utc(2024, 0, 1);
    // When / Then
    expect(getBucketStart(monday, w)).toBe(monday);
    expect(getBucketStart(utc(2024, 0, 7, 23, 59), w)).toBe(monday);
    expect(getBucketStart(utc(2024, 0, 8), w)).toBe(utc(2024, 0, 8));
    expect(getBucketStart(0, w)).toBe(utc(1969, 11, 29));
  });

  it('A4: calendar months', () => {
    // Given
    const t = utc(2024, 1, 15, 8);
    // When / Then
    expect(getBucketStart(t, spec('1M'))).toBe(utc(2024, 1, 1));
    expect(getBucketStart(t, spec('3M'))).toBe(utc(2024, 0, 1));
    expect(getBucketStart(utc(2024, 11, 31), spec('3M'))).toBe(utc(2024, 9, 1));
  });

  it.each([NaN, Infinity, -Infinity])('A5: %p → NaN', (t) => {
    // Given / When / Then
    expect(getBucketStart(t, spec('1m'))).toBeNaN();
    expect(getBucketStart(t, spec('1M'))).toBeNaN();
  });
});

describe('getNextBucketStart', () => {
  it('N1: next bucket open', () => {
    // Given / When / Then
    expect(getNextBucketStart(utc(2024, 0, 1), spec('5m'))).toBe(
      utc(2024, 0, 1, 0, 5)
    );
    expect(getNextBucketStart(utc(2024, 11, 1), spec('1M'))).toBe(
      utc(2025, 0, 1)
    );
    expect(getNextBucketStart(utc(2024, 9, 1), spec('3M'))).toBe(
      utc(2025, 0, 1)
    );
  });
});
