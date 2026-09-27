/**
 * Test perspective table — RollingExtremes / RollingWindow
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                     |
 * |------|--------------------------------------------------------|----------------------|----------------------------------------------|
 * | E1   | random series, periods 1 / 3 / 50, highest + lowest    | Golden (reference)   | equals naive max / min of the window         |
 * | E2   | warm-up bars (`i < period − 1`)                        | Boundary             | NaN                                          |
 * | E3   | NaN / ±∞ value                                         | Abnormal             | NaN for `period` bars, then recovers         |
 * | E4   | peek does not mutate; commit after peek                | Equivalence          | same state as a direct commit                |
 * | E5   | monotonic series (deque at full capacity)              | Boundary (max)       | no ring overflow, correct extremes           |
 * | E6   | ties (equal values)                                    | Boundary             | extreme kept                                 |
 * | R1   | period 3 sums / means                                  | Golden (hand)        | NaN, NaN, 6, 9 / 2, 3                        |
 * | R2   | NaN / ∞ value in the ring                              | Abnormal             | NaN while inside, recovers after `period`    |
 * | R3   | candidate non-finite                                   | Abnormal             | NaN                                          |
 * | R4   | windowValue ages 0 … period − 1                        | Normal               | candidate, then newest → oldest committed    |
 * | R5   | 1000 commits across the 256 resync                     | Boundary             | sum equals the exact window sum              |
 * | R6   | period 1                                               | Boundary (min)       | the candidate itself                         |
 */
import { describe, expect, it } from '@jest/globals';
import { createSeededRandom } from '../../testing/fixtures/random';
import {
  commitExtreme,
  createRollingExtreme,
  peekExtreme,
  stepExtreme,
} from '../builtins/RollingExtremes';
import {
  commitWindow,
  createRollingWindow,
  peekWindowMean,
  peekWindowSum,
  stepWindowMean,
  windowValue,
} from '../builtins/RollingWindow';
import { refHighest, refLowest } from './advancedRefs';

function extremes(values: readonly number[], period: number, sign: 1 | -1) {
  const s = createRollingExtreme(period, sign);
  return values.map((x, i) => stepExtreme(s, i, x, true));
}

function expectSame(a: readonly number[], b: readonly number[]) {
  expect(a.map((v) => (Number.isNaN(v) ? 'NaN' : v))).toEqual(
    b.map((v) => (Number.isNaN(v) ? 'NaN' : v))
  );
}

describe('RollingExtremes', () => {
  it.each([1, 3, 50])(
    'E1: equals the naive window extreme (period %i)',
    (p) => {
      // Given
      const random = createSeededRandom(p);
      const values = Array.from({ length: 500 }, () =>
        Math.round(random() * 100)
      );
      // When
      const hi = extremes(values, p, 1);
      const lo = extremes(values, p, -1);
      // Then
      expectSame(hi, refHighest(values, p));
      expectSame(lo, refLowest(values, p));
    }
  );

  it('E2: warm-up bars have no value', () => {
    // Given / When
    const hi = extremes([5, 1, 7, 2], 3, 1);
    // Then
    expectSame(hi, [NaN, NaN, 7, 7]);
  });

  it.each([NaN, Infinity, -Infinity])(
    'E3: non-finite %p poisons its windows',
    (v) => {
      // Given
      const values = [1, 2, v, 4, 5, 6];
      // When
      const hi = extremes(values, 2, 1);
      const lo = extremes(values, 2, -1);
      // Then
      expectSame(hi, [NaN, 2, NaN, NaN, 5, 6]);
      expectSame(lo, [NaN, 1, NaN, NaN, 4, 5]);
    }
  );

  it('E4: peek is pure; commit after peek equals a direct commit', () => {
    // Given
    const a = createRollingExtreme(3, 1);
    const b = createRollingExtreme(3, 1);
    [4, 9, 2].forEach((x, i) => {
      commitExtreme(a, i, x);
      commitExtreme(b, i, x);
    });
    // When
    const peeked = peekExtreme(a, 3, 100);
    const again = peekExtreme(a, 3, 1);
    stepExtreme(a, 3, 1, true);
    commitExtreme(b, 3, 1);
    // Then
    expect([peeked, again]).toEqual([100, 9]);
    expect(a).toEqual(b);
    expect(peekExtreme(a, 4, 0)).toBe(2);
  });

  it.each([1, -1] as const)(
    'E5: monotonic series fills the deque (sign %i)',
    (sign) => {
      // Given: decreasing for highest / increasing for lowest keeps every value
      const values = Array.from({ length: 40 }, (_, i) => -sign * i);
      // When
      const out = extremes(values, 5, sign);
      // Then
      expectSame(out, sign > 0 ? refHighest(values, 5) : refLowest(values, 5));
    }
  );

  it('E6: ties keep the extreme', () => {
    // Given / When
    const out = extremes([3, 3, 3, 1, 1], 2, 1);
    // Then
    expectSame(out, [NaN, 3, 3, 3, 1]);
  });
});

describe('RollingWindow', () => {
  it('R1: sums and means over period 3', () => {
    // Given
    const w = createRollingWindow(3);
    // When
    const sums = [1, 2, 3, 4].map((x) => {
      const s = peekWindowSum(w, x);
      commitWindow(w, x);
      return s;
    });
    const m = createRollingWindow(2);
    const means = [1, 3, 3].map((x) => stepWindowMean(m, x, true));
    // Then
    expectSame(sums, [NaN, NaN, 6, 9]);
    expectSame(means, [NaN, 2, 3]);
    expect(peekWindowMean(w, 5)).toBe(4);
  });

  it.each([NaN, Infinity])('R2: non-finite %p in the ring', (v) => {
    // Given
    const w = createRollingWindow(2);
    // When
    const out = [1, v, 3, 4, 5].map((x) => stepWindowMean(w, x, true));
    // Then
    expectSame(out, [NaN, NaN, NaN, 3.5, 4.5]);
    expect(w.invalid).toBe(0);
  });

  it('R3: non-finite candidate; peek without commit is pure', () => {
    // Given
    const w = createRollingWindow(1);
    commitWindow(w, 2);
    // When
    const nan = peekWindowSum(w, NaN);
    const peek = stepWindowMean(w, 7, false);
    // Then
    expect(nan).toBeNaN();
    expect(peek).toBe(7);
    expect(w.count).toBe(1);
    expect(w.sum).toBe(2);
  });

  it('R4: windowValue walks from the candidate to the oldest value', () => {
    // Given
    const w = createRollingWindow(3);
    [1, 2, 3, 4].forEach((x) => commitWindow(w, x));
    // When
    const values = [0, 1, 2].map((age) => windowValue(w, 9, age));
    // Then
    expect(values).toEqual([9, 4, 3]);
  });

  it('R5: resync keeps the sum exact across 1000 commits', () => {
    // Given
    const random = createSeededRandom(8);
    const w = createRollingWindow(7);
    const values: number[] = [];
    // When
    for (let i = 0; i < 1000; i++) {
      const x = random() * 1e6;
      values.push(x);
      commitWindow(w, x);
    }
    // Then
    const exact = values.slice(-7).reduce((a, b) => a + b, 0);
    expect(w.sum).toBeCloseTo(exact, 6);
    expect(w.count).toBe(1000);
  });

  it('R6: period 1 returns the candidate', () => {
    // Given
    const w = createRollingWindow(1);
    // When
    const out = [5, 6, NaN, 8].map((x) => stepWindowMean(w, x, true));
    // Then
    expectSame(out, [5, 6, NaN, 8]);
  });
});
