/**
 * Test perspective table — session gaps (index-based X axis, spec Phase 19.4)
 *
 * Fixture: an equity-like session, 30 m bars 14:30–20:30Z Mon–Fri over
 * three weeks (weekends and nights have no bars). The X axis is
 * index-based, so gaps never create empty space: bar `i` is always at
 * `i × barSpacing`.
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                   |
 * |------|--------------------------------------------------------|--------------------|--------------------------------------------|
 * | SG1  | day interval over 15 sessions                          | Equivalence        | one tick per session open after bar 0      |
 * | SG2  | Friday close → Monday open                             | Boundary (gap)     | adjacent indices, Monday tick, no Sat/Sun  |
 * | SG3  | 1 h interval across the overnight gap                  | Equivalence        | session open is a DAY tick, not a time     |
 * | SG4  | estimateBarInterval with weekend / night gaps          | Equivalence        | 30 m (gaps ignored)                        |
 * | SG5  | sparse path (minBars ≥ threshold)                      | Equivalence        | only trading days, heavier ticks kept      |
 * | SG6  | month boundary on a weekend (Sat 1st)                  | Boundary           | month tick on the next trading day         |
 * | SG7  | 24/7 series (no gaps) for contrast                     | Equivalence        | a tick for every calendar day              |
 * | SG8  | single-bar sessions (daily bars, weekdays only)        | Boundary (min)     | positions strictly increasing, no dupes    |
 */
import { describe, expect, it } from '@jest/globals';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../CivilTime';
import {
  TICK_WEIGHT_DAY,
  TICK_WEIGHT_MONTH,
  TICK_WEIGHT_TIME,
} from '../TimeFormat';
import {
  createTimeTicks,
  estimateBarInterval,
  generateTimeTicks,
  SPARSE_TICKS_MIN_BARS,
  TIME_INTERVAL_COUNTS,
  TIME_INTERVAL_UNITS,
  TIME_UNIT_DAY,
  TIME_UNIT_MONTH,
} from '../TimeTicks';
import { createOffsetResolver } from '../TimeZone';

const HALF_HOUR = 30 * MS_PER_MINUTE;
/** Monday 2024-04-15. */
const MONDAY = Date.UTC(2024, 3, 15);

function ladder(unit: number, count: number): number {
  return TIME_INTERVAL_UNITS.findIndex(
    (u, k) => u === unit && TIME_INTERVAL_COUNTS[k] === count
  );
}

/** 30 m bars 14:30–20:30Z on weekdays from `start`, `days` calendar days. */
function sessions(start: number, days: number): Float64Array {
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    const day = start + d * MS_PER_DAY;
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) {
      continue;
    }
    for (
      let t = day + 14.5 * MS_PER_HOUR;
      t <= day + 20.5 * MS_PER_HOUR;
      t += HALF_HOUR
    ) {
      out.push(t);
    }
  }
  return Float64Array.from(out);
}

function run(times: Float64Array, k: number, minBars = 0) {
  const out = createTimeTicks();
  const count = generateTimeTicks(
    { time: times, offset: 0, length: times.length },
    0,
    times.length - 1,
    k,
    createOffsetResolver('utc'),
    minBars,
    out
  );
  return Array.from({ length: count }, (_, i) => ({
    index: out.positions[i] as number,
    weight: out.weights[i] as number,
    time: out.payload[i] as number,
  }));
}

const weekday = (t: number) => new Date(t).getUTCDay();

describe('session gaps', () => {
  const times = sessions(MONDAY, 21);
  const DAY_K = ladder(TIME_UNIT_DAY, 1);

  it('SG1: one tick per session open', () => {
    // Given / When
    const ticks = run(times, DAY_K);
    // Then: 15 sessions, bar 0 is never a tick
    expect(ticks).toHaveLength(14);
    for (const tick of ticks) {
      expect(new Date(tick.time).getUTCHours()).toBe(14);
      expect(tick.weight).toBeGreaterThanOrEqual(TICK_WEIGHT_DAY);
    }
  });

  it('SG2: the weekend gap is one bar wide and gets no label', () => {
    // Given
    const fridayClose = times.findIndex(
      (t) => t === Date.UTC(2024, 3, 19, 20, 30)
    );
    // When
    const ticks = run(times, DAY_K);
    // Then
    const monday = ticks.find((t) => t.index === fridayClose + 1);
    expect(monday).toBeDefined();
    expect(weekday(monday?.time ?? NaN)).toBe(1);
    expect(
      ticks.some((t) => weekday(t.time) === 0 || weekday(t.time) === 6)
    ).toBe(false);
  });

  it('SG3: session opens are day ticks at an hourly interval', () => {
    // Given / When
    const ticks = run(times, ladder(0, MS_PER_HOUR));
    // Then
    const opens = ticks.filter((t) => new Date(t.time).getUTCHours() === 14);
    expect(opens.length).toBe(14);
    expect(opens.every((t) => t.weight >= TICK_WEIGHT_DAY)).toBe(true);
    expect(
      ticks.filter((t) => t.weight === TICK_WEIGHT_TIME).length
    ).toBeGreaterThan(0);
  });

  it('SG4: bar interval estimate ignores gaps', () => {
    // Given / When / Then
    expect(
      estimateBarInterval(
        { time: times, offset: 0, length: times.length },
        1000
      )
    ).toBe(HALF_HOUR);
  });

  it('SG5: sparse ticks keep only trading days', () => {
    // Given / When
    const ticks = run(times, DAY_K, SPARSE_TICKS_MIN_BARS);
    // Then
    expect(ticks.length).toBeGreaterThan(0);
    for (let i = 1; i < ticks.length; i++) {
      const gap = (ticks[i]?.index ?? 0) - (ticks[i - 1]?.index ?? 0);
      expect(gap).toBeGreaterThanOrEqual(SPARSE_TICKS_MIN_BARS);
    }
    expect(
      ticks.every((t) => weekday(t.time) >= 1 && weekday(t.time) <= 5)
    ).toBe(true);
  });

  it('SG6: a month starting on a weekend is marked on the next session', () => {
    // Given: 2024-06-01 is a Saturday
    const june = sessions(Date.UTC(2024, 4, 27), 10);
    // When
    const ticks = run(june, ladder(TIME_UNIT_MONTH, 1));
    // Then
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.weight).toBe(TICK_WEIGHT_MONTH);
    expect(new Date(ticks[0]?.time ?? NaN).toISOString()).toBe(
      '2024-06-03T14:30:00.000Z'
    );
  });

  it('SG7: a 24/7 series has a tick for every day', () => {
    // Given
    const crypto = Float64Array.from(
      { length: 21 * 48 },
      (_, i) => MONDAY + i * HALF_HOUR
    );
    // When
    const ticks = run(crypto, DAY_K);
    // Then
    expect(ticks).toHaveLength(20);
    expect(ticks.some((t) => weekday(t.time) === 6)).toBe(true);
  });

  it('SG8: weekday-only daily bars', () => {
    // Given
    const daily = Float64Array.from(
      Array.from({ length: 60 }, (_, d) => MONDAY + d * MS_PER_DAY).filter(
        (t) => weekday(t) !== 0 && weekday(t) !== 6
      )
    );
    // When
    const ticks = run(daily, ladder(TIME_UNIT_DAY, 1));
    // Then
    const positions = ticks.map((t) => t.index);
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(ticks).toHaveLength(daily.length - 1);
  });
});
