/**
 * Test perspective table — SparseTimeTicks
 *
 * | Case  | Input / Precondition                                        | Perspective        | Expected                                   |
 * |-------|-------------------------------------------------------------|--------------------|--------------------------------------------|
 * | ST01  | random gapped minute / hour / day bars, every ladder entry, | Equivalence (prop.)| identical to the linear scan (unthinned)   |
 * |       | zones utc / +330 / −300                                     |                    |                                            |
 * | ST02  | generateTimeTicks with minBars ≥ SPARSE_TICKS_MIN_BARS      | Equivalence        | same thinned ticks as the linear path      |
 * | ST03  | columns with a physical offset                              | Equivalence        | logical positions                          |
 * | ST04  | tick exactly on the last bar                                | Boundary (max)     | included                                   |
 * | ST05  | first > last; single bar range without a boundary           | Boundary (empty)   | 0 ticks                                    |
 * | ST06  | capacity 0 / 2                                              | Boundary           | 0 / capped at 2                            |
 * | ST07  | NaN bar times                                               | Invalid            | terminates, only finite ticks              |
 * | ST08  | +∞ bar time at the end                                      | Invalid            | no tick at the infinite bar                |
 * | ST09  | device zone with an offset increase (+1 h → +2 h) near a    | Equivalence        | identical to the linear scan (forward      |
 * |       | boundary (DST spring-forward)                                |                    | fix-up after an early guess)               |
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../CivilTime';
import { thinTicksBySpacing } from '../LabelCollision';
import { generateSparseTimeTicks } from '../SparseTimeTicks';
import {
  createTimeTicks,
  generateTimeTicks,
  SPARSE_TICKS_MIN_BARS,
  TIME_INTERVAL_COUNTS,
  TIME_INTERVAL_UNITS,
  TIME_UNIT_DAY,
  TIME_UNIT_MS,
  type TimeColumn,
  type TimeTicks,
} from '../TimeTicks';
import { createOffsetResolver, type ChartTimeZone } from '../TimeZone';
import { createSeededRandom } from '../../testing/fixtures/random';

/** `n` bars of `step` with occasional session gaps (up to 400 steps). */
function gapped(seed: number, start: number, step: number, n: number) {
  const next = createSeededRandom(seed);
  const out = new Float64Array(n);
  let t = start;
  for (let i = 0; i < n; i++) {
    out[i] = t;
    t += step * (next() < 0.03 ? 1 + Math.floor(next() * 400) : 1);
  }
  return out;
}

function col(time: Float64Array, offset = 0): TimeColumn {
  return { time, offset, length: time.length - offset };
}

function snapshot(out: TimeTicks, count: number) {
  return {
    positions: Array.from(out.positions.subarray(0, count)),
    weights: Array.from(out.weights.subarray(0, count)),
    payload: Array.from(out.payload.subarray(0, count)),
  };
}

function sparse(
  times: Float64Array,
  k: number,
  zone: ChartTimeZone,
  out = createTimeTicks(4096),
  offset = 0
) {
  const bars = col(times, offset);
  const count = generateSparseTimeTicks(
    bars,
    1,
    bars.length - 1,
    TIME_INTERVAL_UNITS[k] as number,
    TIME_INTERVAL_COUNTS[k] as number,
    createOffsetResolver(zone),
    out
  );
  return snapshot(out, count);
}

function linear(times: Float64Array, k: number, zone: ChartTimeZone) {
  const out = createTimeTicks(4096);
  const count = generateTimeTicks(
    col(times),
    0,
    times.length - 1,
    k,
    createOffsetResolver(zone),
    0,
    out
  );
  return snapshot(out, count);
}

const unit = (k: number) => TIME_INTERVAL_UNITS[k] as number;
const count = (k: number) => TIME_INTERVAL_COUNTS[k] as number;

describe('generateSparseTimeTicks', () => {
  it('ST01: matches the linear scan for every interval and zone', () => {
    // Given: gapped series at three bar durations
    const cases = [
      { step: MS_PER_MINUTE, n: 6000 },
      { step: MS_PER_HOUR, n: 6000 },
      { step: MS_PER_DAY, n: 4000 },
    ];
    const start = Date.UTC(2019, 10, 28, 21, 17);
    for (const [c, { step, n }] of cases.entries()) {
      const times = gapped(c + 1, start, step, n);
      for (let k = 0; k < TIME_INTERVAL_UNITS.length; k++) {
        const u = unit(k);
        if (u === TIME_UNIT_MS && count(k) < step) {
          continue;
        }
        if (u === TIME_UNIT_DAY && step > MS_PER_DAY) {
          continue;
        }
        for (const zone of ['utc', 330, -300] as const) {
          // When
          const s = sparse(times, k, zone);
          const l = linear(times, k, zone);
          // Then
          expect({ k, zone, ...s }).toEqual({ k, zone, ...l });
        }
      }
    }
  });

  it('ST02: generateTimeTicks switches to the sparse path when zoomed out', () => {
    // Given: 5000 hourly bars, day interval 1, minBars at the threshold
    const times = gapped(7, Date.UTC(2024, 0, 1), MS_PER_HOUR, 5000);
    const k = TIME_INTERVAL_UNITS.findIndex(
      (u, i) => u === TIME_UNIT_DAY && TIME_INTERVAL_COUNTS[i] === 1
    );
    const out = createTimeTicks(4096);
    const expected = createTimeTicks(4096);
    const raw = generateTimeTicks(
      col(times),
      0,
      times.length - 1,
      k,
      createOffsetResolver('utc'),
      0,
      expected
    );
    expected.count = raw;
    const thinned = thinTicksBySpacing(expected, SPARSE_TICKS_MIN_BARS);
    // When
    const got = generateTimeTicks(
      col(times),
      0,
      times.length - 1,
      k,
      createOffsetResolver('utc'),
      SPARSE_TICKS_MIN_BARS,
      out
    );
    // Then: identical thinned ticks (the linear run was not capped)
    expect(raw).toBeLessThan(4096);
    expect(snapshot(out, got)).toEqual(snapshot(expected, thinned));
  });

  it('ST03: returns logical positions for offset columns', () => {
    // Given: 3 padding values, hourly bars crossing midnight at logical 2
    const times = Float64Array.from([
      0,
      0,
      0,
      ...[22, 23, 24, 25].map((h) => Date.UTC(2024, 0, 1, h)),
    ]);
    // When
    const k = TIME_INTERVAL_UNITS.findIndex((u) => u === TIME_UNIT_DAY);
    const got = sparse(times, k, 'utc', createTimeTicks(), 3);
    // Then
    expect(got.positions).toEqual([2]);
  });

  it('ST04: includes a tick on the last bar', () => {
    // Given: the day boundary is crossed by the last bar only
    const times = Float64Array.from(
      [21, 22, 23, 24].map((h) => Date.UTC(2024, 0, 1, h))
    );
    const k = TIME_INTERVAL_UNITS.findIndex((u) => u === TIME_UNIT_DAY);
    // When
    const got = sparse(times, k, 'utc');
    // Then
    expect(got.positions).toEqual([3]);
  });

  it('ST05: returns 0 for an empty range or no boundary', () => {
    // Given
    const times = Float64Array.from([0, MS_PER_MINUTE, 2 * MS_PER_MINUTE]);
    const out = createTimeTicks();
    const resolver = createOffsetResolver('utc');
    // When / Then
    expect(
      generateSparseTimeTicks(col(times), 2, 1, TIME_UNIT_DAY, 1, resolver, out)
    ).toBe(0);
    expect(
      generateSparseTimeTicks(col(times), 1, 2, TIME_UNIT_DAY, 1, resolver, out)
    ).toBe(0);
  });

  it('ST06: caps the output at the buffer capacity', () => {
    // Given: 100 days of hourly bars
    const times = gapped(3, Date.UTC(2024, 0, 1), MS_PER_HOUR, 2400);
    const k = TIME_INTERVAL_UNITS.findIndex((u) => u === TIME_UNIT_DAY);
    // When / Then
    expect(sparse(times, k, 'utc', createTimeTicks(0)).positions).toEqual([]);
    expect(sparse(times, k, 'utc', createTimeTicks(2)).positions).toEqual([
      sparse(times, k, 'utc').positions[0],
      sparse(times, k, 'utc').positions[1],
    ]);
  });

  it('ST07: terminates on NaN bar times and records only finite ticks', () => {
    // Given: NaN holes in hourly bars
    const times = gapped(5, Date.UTC(2024, 0, 1), MS_PER_HOUR, 200);
    times[0] = NaN;
    times[50] = NaN;
    times[51] = NaN;
    const k = TIME_INTERVAL_UNITS.findIndex((u) => u === TIME_UNIT_DAY);
    // When
    const got = sparse(times, k, 'utc');
    // Then
    expect(got.positions.length).toBeGreaterThan(0);
    expect(got.payload.every(Number.isFinite)).toBe(true);
    expect(got.positions).not.toContain(50);
    expect(got.positions).not.toContain(51);
  });

  it('ST08: never ticks a bar with an infinite time', () => {
    // Given: the last bar time is +∞
    const times = Float64Array.from([
      Date.UTC(2024, 0, 1, 22),
      Date.UTC(2024, 0, 1, 23),
      Infinity,
    ]);
    const k = TIME_INTERVAL_UNITS.findIndex((u) => u === TIME_UNIT_DAY);
    // When
    const got = sparse(times, k, 'utc');
    // Then
    expect(got.positions).toEqual([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('ST09: matches the linear scan across a spring-forward transition', () => {
    // Given: device offset +1 h before 2024-03-30 22:30 UTC, +2 h after
    // (local 23:30 → 00:30, so the midnight guess lands early)
    const switchAt = Date.UTC(2024, 2, 30, 22, 30);
    jest
      .spyOn(Date.prototype, 'getTimezoneOffset')
      .mockImplementation(function (this: Date) {
        return this.getTime() < switchAt ? -60 : -120;
      });
    const times = Float64Array.from(
      { length: 4000 },
      (_, i) => Date.UTC(2024, 2, 29) + i * MS_PER_MINUTE
    );
    const hourly = TIME_INTERVAL_COUNTS.findIndex(
      (c, i) => TIME_INTERVAL_UNITS[i] === TIME_UNIT_MS && c === MS_PER_HOUR
    );
    const daily = TIME_INTERVAL_UNITS.findIndex((u) => u === TIME_UNIT_DAY);
    for (const k of [hourly, daily]) {
      // When
      const s = sparse(times, k, 'local');
      const l = linear(times, k, 'local');
      // Then
      expect(s).toEqual(l);
      expect(s.positions.length).toBeGreaterThan(0);
    }
  });
});
