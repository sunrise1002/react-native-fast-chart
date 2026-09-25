/**
 * Test perspective table — TimeTicks
 *
 * | Case | Input / Precondition                                     | Perspective        | Expected                                    |
 * |------|----------------------------------------------------------|--------------------|---------------------------------------------|
 * | TT13 | 1 m bars, 10 m interval                                  | Equivalence        | ticks on :00 / :10 …, weight time / day     |
 * | TT14 | hourly bars crossing midnight / month / year             | Equivalence        | weights day / month / year                  |
 * | TT15 | daily bars, day interval 5                               | Equivalence        | days 1, 6, 11 … 31 + month starts           |
 * | TT16 | daily bars, month interval 3                             | Equivalence        | Jan / Apr / Jul / Oct (+ year)              |
 * | TT17 | yearly-interval ticks on multiples of n                  | Equivalence        | only years % n                              |
 * | TT18 | fixed offset shifts the local day                        | Equivalence        | day boundary at local midnight              |
 * | TT19 | thinning by minBars                                      | Equivalence        | heavier ticks win                           |
 * | TT20 | start 0 → from bar 1; start > end; empty; invalid k      | Boundary / invalid | bar 0 never a tick / 0 ticks                |
 * | TT21 | capacity 2                                               | Boundary (max)     | capped at 2                                 |
 * | TT22 | NaN bar time                                             | Invalid            | skipped                                     |
 * | TT23 | createTimeTicks capacity 0 / NaN / default               | Boundary           | 0 / 0 / 256                                 |
 * | TT24 | columns with a physical offset                           | Equivalence        | logical indices, offset times               |
 */
import { describe, expect, it } from '@jest/globals';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../CivilTime';
import {
  TICK_WEIGHT_DAY,
  TICK_WEIGHT_MONTH,
  TICK_WEIGHT_TIME,
  TICK_WEIGHT_YEAR,
} from '../TimeFormat';
import {
  createTimeTicks,
  generateTimeTicks,
  TIME_INTERVAL_COUNTS,
  TIME_INTERVAL_UNITS,
  TIME_TICK_CAPACITY,
  TIME_UNIT_DAY,
  TIME_UNIT_MONTH,
  TIME_UNIT_YEAR,
  type TimeTicks,
} from '../TimeTicks';
import { createOffsetResolver } from '../TimeZone';

const MIN = MS_PER_MINUTE;
const utc = () => createOffsetResolver('utc');

/** Ladder index of `(unit, count)`. */
function ladder(unit: number, count: number): number {
  return TIME_INTERVAL_UNITS.findIndex(
    (u, k) => u === unit && TIME_INTERVAL_COUNTS[k] === count
  );
}

function col(time: ArrayLike<number>, offset = 0) {
  return { time, offset, length: time.length - offset };
}

function series(start: number, step: number, n: number): Float64Array {
  return Float64Array.from({ length: n }, (_, i) => start + i * step);
}

function run(
  times: Float64Array,
  k: number,
  minBars = 0,
  zone: 'utc' | number = 'utc',
  out: TimeTicks = createTimeTicks()
) {
  const count = generateTimeTicks(
    col(times),
    0,
    times.length - 1,
    k,
    createOffsetResolver(zone),
    minBars,
    out
  );
  return {
    count,
    positions: Array.from(out.positions.subarray(0, count)),
    weights: Array.from(out.weights.subarray(0, count)),
    payload: Array.from(out.payload.subarray(0, count)),
  };
}

describe('generateTimeTicks', () => {
  it('TT13: minute bars tick on 10-minute boundaries', () => {
    // Given: 23:55 … 00:25
    const start = Date.UTC(2024, 2, 14, 23, 55);
    const times = series(start, MIN, 31);
    // When
    const { positions, weights } = run(times, ladder(0, 10 * MIN));
    // Then: 00:00 (day), 00:10, 00:20
    expect(positions).toEqual([5, 15, 25]);
    expect(weights).toEqual([
      TICK_WEIGHT_DAY,
      TICK_WEIGHT_TIME,
      TICK_WEIGHT_TIME,
    ]);
  });

  it('TT14: weights reflect the largest boundary crossed', () => {
    // Given: hourly bars from 2023-12-31 22:00
    const times = series(Date.UTC(2023, 11, 31, 22), MS_PER_HOUR, 4);
    const k = ladder(0, MS_PER_HOUR);
    // When
    const { weights, positions } = run(times, k);
    // Then: 23:00 time, 00:00 year, 01:00 time
    expect(positions).toEqual([1, 2, 3]);
    expect(weights).toEqual([
      TICK_WEIGHT_TIME,
      TICK_WEIGHT_YEAR,
      TICK_WEIGHT_TIME,
    ]);
    const feb = run(series(Date.UTC(2024, 0, 31, 23), MS_PER_HOUR, 2), k);
    expect(feb.weights).toEqual([TICK_WEIGHT_MONTH]);
  });

  it('TT15: day interval 5 ticks days 1, 6, 11 … and month starts', () => {
    // Given: daily bars 2024-01-28 … 2024-02-12
    const times = series(Date.UTC(2024, 0, 28), MS_PER_DAY, 16);
    // When
    const { payload, weights } = run(times, ladder(TIME_UNIT_DAY, 5));
    // Then: 31 is 1 + 6 × 5; thinning later lets the month start win
    const days = payload.map((t) => new Date(t).getUTCDate());
    expect(days).toEqual([31, 1, 6, 11]);
    expect(weights[1]).toBe(TICK_WEIGHT_MONTH);
  });

  it('TT16: month interval 3 ticks quarter starts and years', () => {
    // Given: daily bars over 14 months from 2023-12-15
    const times = series(Date.UTC(2023, 11, 15), MS_PER_DAY, 425);
    // When
    const { payload, weights } = run(times, ladder(TIME_UNIT_MONTH, 3));
    // Then
    const months = payload.map((t) => new Date(t).getUTCMonth() + 1);
    expect(months).toEqual([1, 4, 7, 10, 1]);
    expect(weights).toEqual([4, 3, 3, 3, 4]);
  });

  it('TT17: year interval 5 ticks multiples of 5 only', () => {
    // Given: yearly-ish bars (365 d) from 2019
    const times = series(Date.UTC(2019, 6, 1), 365 * MS_PER_DAY, 12);
    // When
    const { payload } = run(times, ladder(TIME_UNIT_YEAR, 5));
    // Then
    const years = payload.map((t) => new Date(t).getUTCFullYear());
    expect(years).toEqual([2020, 2025, 2030]);
  });

  it('TT18: a fixed offset moves the day boundary', () => {
    // Given: hourly bars 2024-03-14 12:00 … 16:00 UTC, UTC+9 → midnight at 15:00
    const times = series(Date.UTC(2024, 2, 14, 12), MS_PER_HOUR, 5);
    // When
    const { positions, weights, payload } = run(
      times,
      ladder(0, MS_PER_HOUR),
      0,
      540
    );
    // Then
    expect(weights[positions.indexOf(3)]).toBe(TICK_WEIGHT_DAY);
    expect(payload[positions.indexOf(3)]).toBe(Date.UTC(2024, 2, 15));
  });

  it('TT19: thins by minBars keeping heavier ticks', () => {
    // Given
    const start = Date.UTC(2024, 2, 14, 23, 55);
    const times = series(start, MIN, 31);
    // When: labels ≥ 12 bars apart
    const { positions } = run(times, ladder(0, 10 * MIN), 12);
    // Then: 00:00 (day) kept, 00:10 dropped, 00:20 kept
    expect(positions).toEqual([5, 25]);
  });

  it('TT20: bar 0 is never a tick; empty / invalid ranges yield none', () => {
    // Given
    const times = series(Date.UTC(2024, 0, 1), MS_PER_HOUR, 5);
    const k = ladder(0, MS_PER_HOUR);
    const out = createTimeTicks();
    // When / Then
    expect(run(times, k).positions[0]).toBe(1);
    const bars = col(times);
    const empty = { time: times, offset: 0, length: 0 };
    expect(generateTimeTicks(bars, 4, 2, k, utc(), 0, out)).toBe(0);
    expect(generateTimeTicks(empty, 0, 10, k, utc(), 0, out)).toBe(0);
    expect(generateTimeTicks(bars, 0, 4, -1, utc(), 0, out)).toBe(0);
    expect(generateTimeTicks(bars, 0, 4, 999, utc(), 0, out)).toBe(0);
    expect(generateTimeTicks(bars, NaN, 4, k, utc(), 0, out)).toBe(0);
    expect(out.count).toBe(0);
  });

  it('TT21: caps at the buffer capacity', () => {
    // Given
    const times = series(Date.UTC(2024, 0, 1), MS_PER_HOUR, 10);
    // When
    const r = run(times, ladder(0, MS_PER_HOUR), 0, 'utc', createTimeTicks(2));
    // Then
    expect(r.count).toBe(2);
  });

  it('TT22: skips bars with a NaN time', () => {
    // Given
    const times = series(Date.UTC(2024, 0, 1), MS_PER_HOUR, 4);
    times[2] = NaN;
    // When
    const { positions } = run(times, ladder(0, MS_PER_HOUR));
    // Then
    expect(positions).not.toContain(2);
  });

  it('TT24: honors the physical offset of the columns', () => {
    // Given: 3 junk slots, then hourly bars crossing midnight at logical bar 2
    const hours = series(Date.UTC(2024, 0, 1, 22), MS_PER_HOUR, 4);
    const time = Float64Array.from([0, 0, 0, ...hours]);
    const out = createTimeTicks();
    // When
    const count = generateTimeTicks(
      col(time, 3),
      0,
      3,
      ladder(0, MS_PER_HOUR),
      utc(),
      0,
      out
    );
    // Then
    expect(count).toBe(3);
    expect(Array.from(out.positions.subarray(0, 3))).toEqual([1, 2, 3]);
    expect(out.weights[1]).toBe(TICK_WEIGHT_DAY);
  });

  it.each([
    [0, 0],
    [NaN, 0],
    [3.5, 4],
  ])('TT23: capacity %p → %p', (capacity, size) => {
    // Given / When / Then
    expect(createTimeTicks(capacity).positions.length).toBe(size);
  });

  it('TT23: default capacity', () => {
    // Given / When / Then
    expect(createTimeTicks().positions.length).toBe(TIME_TICK_CAPACITY);
  });
});
