/**
 * Test perspective table — computePaneRange (per-pane Y scale strategies)
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                      |
 * |------|--------------------------------------------------------|----------------------|-----------------------------------------------|
 * | F1   | fixed 0–100                                            | Normal               | −5 … 105 regardless of values                 |
 * | F2   | fixed max ≤ min / NaN / infinite span                  | Invalid input        | false, NaN                                    |
 * | V1   | volume values 10…50                                    | Normal               | 0 … 55                                        |
 * | V2   | volume all 0                                           | Boundary (0)         | 0 … 1.1                                       |
 * | Z1   | zeroCentered all positive / all negative / mixed       | Equivalence          | includes 0, padded                            |
 * | A1   | auto 10 … 20                                           | Normal               | 9 … 21                                        |
 * | A2   | auto flat values                                       | Boundary             | non-degenerate (±1 %)                         |
 * | A3   | only NaN values / no refs / unaligned series           | Abnormal / empty     | false                                         |
 * | A4   | visible slice limits (start/end, clipped to length)    | Boundary             | only values inside the slice                  |
 * | A5   | huge values (±1e300)                                   | Boundary (max)       | finite range                                  |
 * | A6   | several refs                                           | Normal               | union of the outputs                          |
 */
import { describe, expect, it } from '@jest/globals';
import { createUiCandleSeries } from '../../data/UiCandleSeries';
import type { UiIndicatorSet } from '../../indicators/UiIndicatorSet';
import { columnsOf } from '../../indicators/__tests__/indicatorTestUtils';
import { computePaneRange } from '../PaneScale';

const candles = createUiCandleSeries(columnsOf(new Array(10).fill(100)), 0, 3);

function set(...columns: number[][]): UiIndicatorSet {
  return {
    revision: 1,
    series: {
      a: {
        outputs: columns.map((c) => Float64Array.from(c)),
        length: 10,
        resetVersion: 3,
        firstTime: candles.time[0] as number,
      },
    },
  };
}
const pad = (values: number[]) => [
  ...values,
  ...new Array(10 - values.length).fill(NaN),
];
const A0 = [{ id: 'a', output: 0 }];

function range(
  scale: Parameters<typeof computePaneRange>[0],
  s: UiIndicatorSet,
  refs = A0,
  start = 0,
  end = 9
) {
  const out = { min: 0, max: 0 };
  const valid = computePaneRange(scale, s, candles, refs, start, end, out);
  return { valid, ...out };
}

describe('computePaneRange', () => {
  it('F1: fixed range with padding', () => {
    // Given / When
    const r = range({ kind: 'fixed', min: 0, max: 100 }, set(pad([500])));
    // Then
    expect(r).toEqual({ valid: true, min: -5, max: 105 });
  });

  it.each([
    [5, 5],
    [NaN, 1],
    [-Infinity, 0],
    [-1e308, 1e308],
  ])('F2: invalid fixed range %p … %p', (min, max) => {
    // Given / When
    const r = range({ kind: 'fixed', min, max }, set(pad([1])));
    // Then
    expect(r.valid).toBe(false);
    expect(r.min).toBeNaN();
  });

  it('V1 / V2: volume 0 … max with headroom', () => {
    // Given / When
    const v = range({ kind: 'volume' }, set(pad([10, 50, 30])));
    const zero = range({ kind: 'volume' }, set(pad([0, 0])));
    // Then
    expect(v.min).toBe(0);
    expect(v.max).toBeCloseTo(55, 10);
    expect(zero.min).toBe(0);
    expect(zero.max).toBeCloseTo(1.1, 10);
  });

  it('Z1: zeroCentered always includes 0', () => {
    // Given / When
    const pos = range({ kind: 'zeroCentered' }, set(pad([2, 4])));
    const neg = range({ kind: 'zeroCentered' }, set(pad([-2, -4])));
    const mixed = range({ kind: 'zeroCentered' }, set(pad([-1, 3])));
    // Then
    expect([pos.min, pos.max]).toEqual([-0.4, 4.4]);
    expect([neg.min, neg.max]).toEqual([-4.4, 0.4]);
    expect([mixed.min, mixed.max]).toEqual([-1.4, 3.4]);
  });

  it('A1 / A2: auto range, flat values', () => {
    // Given / When
    const r = range({ kind: 'auto' }, set(pad([10, 20, 15])));
    const flat = range({ kind: 'price' }, set(pad([50, 50])));
    // Then
    expect(r.min).toBeCloseTo(9, 10);
    expect(r.max).toBeCloseTo(21, 10);
    expect(flat.max).toBeGreaterThan(flat.min);
    expect((flat.min + flat.max) / 2).toBeCloseTo(50, 10);
  });

  it('A3: nothing drawable', () => {
    // Given
    const unaligned = set(pad([1, 2]));
    (unaligned.series.a as { resetVersion: number }).resetVersion = 99;
    // When / Then
    expect(range({ kind: 'auto' }, set(pad([]))).valid).toBe(false);
    expect(range({ kind: 'auto' }, set(pad([1])), []).valid).toBe(false);
    expect(range({ kind: 'volume' }, unaligned).valid).toBe(false);
    expect(
      range({ kind: 'auto' }, set(pad([1])), [{ id: 'zz', output: 0 }]).valid
    ).toBe(false);
  });

  it('A4: only the visible slice counts', () => {
    // Given
    const s = set([100, 1, 2, 3, 4, 5, 6, 7, 8, -100]);
    // When
    const r = range({ kind: 'auto' }, s, A0, 1.5, 7.2);
    const beyond = range({ kind: 'auto' }, s, A0, -20, 50);
    // Then: bars 2 … 7
    expect(r.min).toBeCloseTo(2 - 0.5, 10);
    expect(r.max).toBeCloseTo(7 + 0.5, 10);
    expect(beyond.max).toBeCloseTo(120, 10);
  });

  it('A5 / A6: huge values stay finite; refs are merged', () => {
    // Given
    const s = set(pad([1e300, -1e300]), pad([5]));
    // When
    const huge = range({ kind: 'auto' }, s);
    const both = range({ kind: 'auto' }, set(pad([1, 2]), pad([10])), [
      { id: 'a', output: 0 },
      { id: 'a', output: 1 },
    ]);
    // Then
    expect(Number.isFinite(huge.min) && Number.isFinite(huge.max)).toBe(true);
    expect(both.min).toBeCloseTo(0.1, 10);
    expect(both.max).toBeCloseTo(10.9, 10);
  });
});
