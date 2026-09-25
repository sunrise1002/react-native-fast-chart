/**
 * Test perspective table — Bollinger Bands
 *
 * | Case | Input / Precondition                         | Perspective          | Expected                                       |
 * |------|----------------------------------------------|----------------------|------------------------------------------------|
 * | G1   | 1,2,3,4,5 period 3, k 2                      | Golden (hand)        | σ = √(2/3), basis 2,3,4                         |
 * | G2   | 2000 generated bars, periods 1/20/300        | Golden (reference)   | equals naive population-σ reference (1e-9)      |
 * | B1   | constant series                              | Boundary (σ = 0)     | upper = middle = lower                          |
 * | B2   | period > length / empty                      | Boundary             | NaN everywhere / length 0                       |
 * | B3   | period 1                                     | Boundary (min)       | zero width                                      |
 * | A1   | NaN in window                                | Abnormal             | NaN bands while in window, recovers             |
 * | A2   | huge prices (1e12) with tiny moves           | Abnormal (precision) | σ finite, ≥ 0, matches reference                |
 * | C1   | config: invalid stdDev / period / source     | Invalid input        | defaults / clamped                              |
 * | C2   | label, meta series                           | Equivalence          | `BB 20 2`, band + basis descriptors             |
 */
import { describe, expect, it } from '@jest/globals';
import { CandleStore } from '../../data/CandleStore';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import {
  BOLLINGER_LOWER,
  BOLLINGER_MIDDLE,
  BOLLINGER_UPPER,
  bollingerModule,
} from '../builtins/Bollinger';
import { columnsOf, expectSeries, refBollinger } from './indicatorTestUtils';

function bb(values: Parameters<typeof columnsOf>[0], period: number, k = 2) {
  const r = bollingerModule.indicator.calculate(columnsOf(values), {
    period,
    stdDev: k,
    source: 'close',
  });
  return {
    r,
    upper: r.outputs[BOLLINGER_UPPER] as Float64Array,
    middle: r.outputs[BOLLINGER_MIDDLE] as Float64Array,
    lower: r.outputs[BOLLINGER_LOWER] as Float64Array,
  };
}

describe('Bollinger Bands', () => {
  it('G1: hand-computed bands', () => {
    // Given / When
    const { upper, middle, lower } = bb([1, 2, 3, 4, 5], 3);
    // Then
    const w = 2 * Math.sqrt(2 / 3);
    expectSeries(middle, [NaN, NaN, 2, 3, 4]);
    expectSeries(upper, [NaN, NaN, 2 + w, 3 + w, 4 + w]);
    expectSeries(lower, [NaN, NaN, 2 - w, 3 - w, 4 - w]);
  });

  it.each([1, 20, 300])('G2: period %i matches the reference', (p) => {
    // Given
    const c = new CandleStore(generateCandles({ count: 2000, seed: 5 }))
      .columns;
    // When
    const r = bollingerModule.indicator.calculate(c, {
      period: p,
      stdDev: 2.5,
      source: 'hlc3',
    });
    // Then
    const ref = refBollinger(c, p, 2.5, 'hlc3');
    expectSeries(r.outputs[BOLLINGER_UPPER] as Float64Array, ref.upper);
    expectSeries(r.outputs[BOLLINGER_MIDDLE] as Float64Array, ref.middle);
    expectSeries(r.outputs[BOLLINGER_LOWER] as Float64Array, ref.lower);
  });

  it('B1: constant series has zero width', () => {
    // Given / When
    const { upper, middle, lower } = bb([7, 7, 7, 7], 2);
    // Then
    expectSeries(upper, [NaN, 7, 7, 7]);
    expectSeries(middle, [NaN, 7, 7, 7]);
    expectSeries(lower, [NaN, 7, 7, 7]);
  });

  it('B2: period > length and empty input', () => {
    // Given / When
    const short = bb([1, 2], 3);
    const empty = bb([], 3);
    // Then
    expectSeries(short.upper, [NaN, NaN]);
    expect(empty.r.length).toBe(0);
    expect(empty.r.outputs).toHaveLength(3);
  });

  it('B3: period 1 has zero width', () => {
    // Given / When
    const { upper, lower } = bb([3, 9], 1);
    // Then
    expectSeries(upper, [3, 9]);
    expectSeries(lower, [3, 9]);
  });

  it('A1: NaN inside the window', () => {
    // Given / When
    const { middle, upper } = bb([1, 2, NaN, 4, 6], 2);
    // Then
    expectSeries(middle, [NaN, 1.5, NaN, NaN, 5]);
    expectSeries(upper, [NaN, 2.5, NaN, NaN, 7]);
  });

  it('A2: huge prices keep precision', () => {
    // Given
    const values = Array.from({ length: 700 }, (_, i) => 1e12 + (i % 3));
    const c = columnsOf(values);
    // When
    const r = bollingerModule.indicator.calculate(c, {
      period: 30,
      stdDev: 2,
      source: 'close',
    });
    // Then
    const ref = refBollinger(c, 30, 2);
    const upper = r.outputs[BOLLINGER_UPPER] as Float64Array;
    expectSeries(upper, ref.upper, 1e-12);
    for (let i = 29; i < 700; i++) {
      expect(upper[i]).toBeGreaterThan(1e12);
    }
  });

  it('C1: tolerant config resolution', () => {
    // Given / When / Then
    expect(bollingerModule.resolveConfig({})).toEqual({
      period: 20,
      stdDev: 2,
      source: 'close',
    });
    expect(
      bollingerModule.resolveConfig({ period: -4, stdDev: 0, source: 1 })
    ).toEqual({ period: 1, stdDev: 0.001, source: 'close' });
    expect(bollingerModule.resolveConfig({ stdDev: 2.25 }).stdDev).toBe(2.25);
    expect(bollingerModule.resolveConfig({ stdDev: 99 }).stdDev).toBe(50);
  });

  it('C2: label and series descriptors', () => {
    // Given / When / Then
    expect(
      bollingerModule.formatLabel({ period: 20, stdDev: 2, source: 'close' })
    ).toBe('BB 20 2');
    expect(bollingerModule.meta.series.map((s) => s.kind)).toEqual([
      'line',
      'band',
    ]);
  });
});
