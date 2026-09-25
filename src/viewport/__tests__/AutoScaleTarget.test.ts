/**
 * Test perspective table — AutoScaleTarget
 *
 * | Case | Input / Precondition                                 | Perspective        | Expected                              |
 * |------|------------------------------------------------------|--------------------|---------------------------------------|
 * | A1   | visible bars low 10 / high 20, default padding       | Equivalence        | [9, 21]                               |
 * | A2   | bars outside the viewport are extreme                | Equivalence        | ignored (no overscan)                 |
 * | A3   | custom padding 0                                     | Boundary           | raw [10, 20]                          |
 * | A4   | no bars / nothing visible / all NaN                  | Boundary / invalid | false, `out` = NaN (AutoScale rule)   |
 * | A5   | scratch range object                                 | Equivalence        | reused                                |
 * | A6   | extender widens the raw range before padding         | Equivalence        | padded [min, max] of candles ∪ ext    |
 * | A7   | extender with nothing visible                        | Boundary           | not called, false                     |
 * | S1   | current range NaN / ∞ / max <= min                   | Invalid            | snap                                  |
 * | S2   | disjoint above / below                               | Boundary           | snap                                  |
 * | S3   | overlapping / touching                               | Boundary           | animate (false)                       |
 * | C1   | identical / within epsilon                           | Equivalence / ±ε   | unchanged                             |
 * | C2   | beyond epsilon (min or max)                          | Boundary (+ε)      | changed                               |
 * | C3   | NaN in either / zero-span target                     | Invalid / boundary | changed (NaN) / exact compare         |
 */
import { describe, expect, it } from '@jest/globals';
import type { CandleColumns } from '../../data/CandleBuffer';
import {
  computeAutoScaleTarget,
  priceRangeChanged,
  shouldSnapPriceRange,
} from '../AutoScaleTarget';
import type { TimeScaleState } from '../TimeScale';

function columns(lows: number[], highs: number[]): CandleColumns {
  const n = lows.length;
  return {
    time: Float64Array.from(lows, (_, i) => i),
    open: Float64Array.from(lows),
    high: Float64Array.from(highs),
    low: Float64Array.from(lows),
    close: Float64Array.from(highs),
    volume: new Float64Array(n),
    offset: 0,
    length: n,
  };
}

/** 10 slots wide, last bar at the right edge. */
const time = (barCount: number): TimeScaleState => ({
  width: 100,
  barSpacing: 10,
  rightOffset: 0,
  barCount,
});

describe('computeAutoScaleTarget', () => {
  it('A6: extender widens the visible range before padding', () => {
    // Given
    const cols = columns([10, 12], [14, 20]);
    const out = { min: 0, max: 0 };
    const calls: number[][] = [];
    const extender = {
      extend(start: number, end: number, range: { min: number; max: number }) {
        calls.push([start, end, range.min, range.max]);
        range.max = 30;
      },
    };
    // When
    const ok = computeAutoScaleTarget(
      cols,
      time(2),
      out,
      { paddingTop: 0, paddingBottom: 0 },
      undefined,
      extender
    );
    // Then
    expect(ok).toBe(true);
    expect(calls).toEqual([[0, 1, 10, 20]]);
    expect(out).toEqual({ min: 10, max: 30 });
  });

  it('A7: extender is not called when nothing is visible', () => {
    // Given
    const calls: number[] = [];
    const out = { min: 0, max: 0 };
    // When
    const ok = computeAutoScaleTarget(
      columns([], []),
      time(0),
      out,
      {},
      undefined,
      {
        extend: () => calls.push(1),
      }
    );
    // Then
    expect(ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('A1: pads the visible low/high by 10%', () => {
    // Given
    const cols = columns([10, 12, 15], [14, 20, 18]);
    const out = { min: 0, max: 0 };
    // When
    const ok = computeAutoScaleTarget(cols, time(3), out);
    // Then
    expect(ok).toBe(true);
    expect(out.min).toBeCloseTo(9, 9);
    expect(out.max).toBeCloseTo(21, 9);
  });

  it('A2: ignores bars scrolled off screen', () => {
    // Given: 15 bars, only the last 10 visible; bar 0 is extreme
    const lows = Array.from({ length: 15 }, (_, i) => (i === 0 ? -1000 : 10));
    const highs = Array.from({ length: 15 }, (_, i) => (i === 0 ? 1000 : 20));
    const out = { min: 0, max: 0 };
    // When
    computeAutoScaleTarget(columns(lows, highs), time(15), out, {
      paddingTop: 0,
      paddingBottom: 0,
    });
    // Then
    expect(out).toEqual({ min: 10, max: 20 });
  });

  it('A3: honours custom padding', () => {
    // Given
    const out = { min: 0, max: 0 };
    // When
    computeAutoScaleTarget(columns([10], [20]), time(1), out, {
      paddingTop: 0,
      paddingBottom: 0,
    });
    // Then
    expect(out).toEqual({ min: 10, max: 20 });
  });

  it.each([
    ['no bars', columns([], []), time(0)],
    [
      'scrolled past the data',
      columns([10], [20]),
      { ...time(1), rightOffset: 50 },
    ],
    ['all NaN', columns([NaN], [NaN]), time(1)],
    ['NaN spacing', columns([10], [20]), { ...time(1), barSpacing: NaN }],
  ])('A4: %s → false, out set to NaN', (_label, cols, t) => {
    // Given
    const out = { min: 1, max: 2 };
    // When
    const ok = computeAutoScaleTarget(cols, t, out);
    // Then
    expect(ok).toBe(false);
    expect(out).toEqual({ min: NaN, max: NaN });
  });

  it('A5: writes the visible range into the scratch object', () => {
    // Given
    const scratch = { startIndex: 0, endIndex: -1 };
    // When
    computeAutoScaleTarget(
      columns([1, 2], [3, 4]),
      time(2),
      { min: 0, max: 0 },
      {},
      scratch
    );
    // Then
    expect(scratch).toEqual({ startIndex: 0, endIndex: 1 });
  });
});

describe('shouldSnapPriceRange', () => {
  const target = { min: 10, max: 20 };

  it.each([
    [NaN, 20],
    [10, Infinity],
    [20, 20],
    [30, 20],
  ])('S1: current [%p, %p] is invalid → snap', (lo, hi) => {
    // Given / When / Then
    expect(shouldSnapPriceRange(lo, hi, target)).toBe(true);
  });

  it.each([
    [21, 30],
    [0, 9],
  ])('S2: disjoint [%p, %p] → snap', (lo, hi) => {
    // Given / When / Then
    expect(shouldSnapPriceRange(lo, hi, target)).toBe(true);
  });

  it.each([
    [15, 25],
    [20, 30],
    [0, 10],
  ])('S3: overlapping [%p, %p] → animate', (lo, hi) => {
    // Given / When / Then
    expect(shouldSnapPriceRange(lo, hi, target)).toBe(false);
  });
});

describe('priceRangeChanged', () => {
  it('C1: ignores differences within epsilon of the span', () => {
    // Given
    const b = { min: 0, max: 100 };
    // When / Then
    expect(priceRangeChanged({ min: 0, max: 100 }, b)).toBe(false);
    expect(priceRangeChanged({ min: 5e-5, max: 100 }, b)).toBe(false);
  });

  it.each([[{ min: 2e-4, max: 100 }], [{ min: 0, max: 100.001 }]])(
    'C2: detects change beyond epsilon (%p)',
    (a) => {
      // Given / When / Then
      expect(priceRangeChanged(a, { min: 0, max: 100 })).toBe(true);
    }
  );

  it('C3: NaN counts as changed; zero span compares exactly', () => {
    // Given / When / Then
    expect(priceRangeChanged({ min: NaN, max: 1 }, { min: 0, max: 1 })).toBe(
      true
    );
    expect(priceRangeChanged({ min: 0, max: 1 }, { min: 0, max: NaN })).toBe(
      true
    );
    expect(priceRangeChanged({ min: 5, max: 5 }, { min: 5, max: 5 })).toBe(
      false
    );
    expect(priceRangeChanged({ min: 5, max: 5.1 }, { min: 5, max: 5 })).toBe(
      true
    );
  });
});
