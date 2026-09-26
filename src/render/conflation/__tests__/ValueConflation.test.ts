/**
 * Test perspective table — ValueConflation (indicator envelopes)
 *
 * | Case  | Input / Precondition                                    | Perspective        | Expected                                   |
 * |-------|---------------------------------------------------------|--------------------|--------------------------------------------|
 * | VC01  | random values with NaN warm-up, g 4 / 32                | Equivalence (prop.)| min/max/first/last = brute force           |
 * | VC02  | peak: [-5, 3], [2, -2], [1, 4]                           | Equivalence        | -5 / 2 (tie → max) / 4                     |
 * | VC03  | all-NaN group                                           | Invalid            | ±∞ envelope, NaN peak                      |
 * | VC04  | length < values.length; empty range                     | Boundary           | clamped to length / 0                      |
 * | VC05  | output capacity growth                                  | Boundary           | buffers grow                               |
 * | VE01  | rising, falling, flat buckets                           | Equivalence        | lo→hi / hi→lo / 1 point                    |
 * | VE02  | empty bucket between buckets                            | Invalid            | line breaks (moveTo again)                 |
 * | VE03  | NaN x (degenerate scale), zero buckets                  | Invalid / empty    | 0 points                                   |
 */
import { describe, expect, it } from '@jest/globals';
import { createMinMaxPyramid, syncPyramid } from '../../../data/MinMaxPyramid';
import { createPriceScale } from '../../../viewport/PriceScale';
import type { TimeScaleState } from '../../../viewport/TimeScale';
import { createConflatedValues, type ConflatedValues } from '../Conflation';
import { buildEnvelopeLine, conflateValues } from '../ValueConflation';

const time: TimeScaleState = {
  width: 300,
  barSpacing: 0.5,
  rightOffset: 0,
  barCount: 600,
};

function conflate(values: Float64Array, group: number, length = values.length) {
  const p = createMinMaxPyramid();
  syncPyramid(p, values, values, 0, length, 0);
  const out = createConflatedValues();
  const count = conflateValues(
    values,
    length,
    p,
    0,
    length - 1,
    time,
    group,
    out,
    {
      min: NaN,
      max: NaN,
    }
  );
  return { out, count };
}

function recorder() {
  const ops: string[] = [];
  return {
    ops,
    sink: {
      moveTo: (x: number, y: number) => ops.push(`M${x},${y}`),
      lineTo: (x: number, y: number) => ops.push(`L${x},${y}`),
    },
  };
}

describe('conflateValues', () => {
  it('VC01: envelopes match brute force', () => {
    // Given: a sine with 10 NaN warm-up bars
    const values = Float64Array.from({ length: 600 }, (_, i) =>
      i < 10 ? NaN : Math.sin(i / 7) * 50
    );
    for (const group of [4, 32]) {
      // When
      const { out, count } = conflate(values, group);
      // Then
      expect(count).toBe(Math.ceil(600 / group));
      for (let b = 0; b < count; b++) {
        const slice = Array.from(
          values.subarray(b * group, Math.min(600, (b + 1) * group))
        ).filter(Number.isFinite);
        const min = slice.length ? Math.min(...slice) : Infinity;
        const max = slice.length ? Math.max(...slice) : -Infinity;
        expect([b, out.min[b], out.max[b]]).toEqual([b, min, max]);
        expect(out.first[b]).toEqual(values[b * group]);
        expect(out.last[b]).toEqual(values[Math.min(600, (b + 1) * group) - 1]);
      }
    }
  });

  it('VC02: peak keeps the largest magnitude with its sign', () => {
    // Given
    const values = Float64Array.from([-5, 3, 2, -2, 1, 4]);
    // When
    const { out } = conflate(values, 2);
    // Then
    expect(Array.from(out.peak.subarray(0, 3))).toEqual([-5, 2, 4]);
  });

  it('VC03: all-NaN groups have an empty envelope', () => {
    // Given
    const values = Float64Array.from([NaN, NaN, 1, 2]);
    // When
    const { out } = conflate(values, 2);
    // Then
    expect([out.min[0], out.max[0], out.peak[0]]).toEqual([
      Infinity,
      -Infinity,
      NaN,
    ]);
    expect(out.peak[1]).toBe(2);
  });

  it('VC04: clamps to the length and handles empty ranges', () => {
    // Given
    const values = Float64Array.from([1, 2, 3, 4, 99, 99]);
    // When
    const { out, count } = conflate(values, 2, 4);
    const empty = conflate(values, 2, 0);
    const p = createMinMaxPyramid();
    const over = conflateValues(
      values.subarray(0, 2),
      10,
      p,
      0,
      9,
      time,
      2,
      createConflatedValues(),
      { min: NaN, max: NaN }
    );
    // Then
    expect(count).toBe(2);
    expect(out.max[1]).toBe(4);
    expect(empty.count).toBe(0);
    expect(over).toBe(1);
  });

  it('VC05: grows the output buffers', () => {
    // Given
    const values = new Float64Array(100).fill(1);
    // When
    const { out } = conflate(values, 2);
    // Then
    expect(out.min.length).toBeGreaterThanOrEqual(50);
    expect(out.peak.length).toBe(out.min.length);
  });
});

function envelope(
  rows: [min: number, max: number, first: number, last: number][],
  width = 300
): ConflatedValues {
  const env = createConflatedValues(rows.length);
  rows.forEach(([min, max, first, last], b) => {
    env.min[b] = min;
    env.max[b] = max;
    env.first[b] = first;
    env.last[b] = last;
  });
  env.length = rows.length;
  env.scale = { width, barSpacing: 10, rightOffset: 0, barCount: rows.length };
  return env;
}

const price = createPriceScale({ min: 0, max: 100 }, 0, 100, {
  paddingTop: 0,
  paddingBottom: 0,
});

describe('buildEnvelopeLine', () => {
  it('VE01: orders each bucket by its trend', () => {
    // Given: rising, falling, flat buckets
    const env = envelope([
      [10, 20, 10, 20],
      [30, 40, 40, 30],
      [50, 50, 50, 50],
    ]);
    const { ops, sink } = recorder();
    // When
    const points = buildEnvelopeLine(env, price, sink);
    // Then
    expect(points).toBe(5);
    expect(ops).toEqual([
      'M275,90',
      'L275,80',
      'L285,60',
      'L285,70',
      'L295,50',
    ]);
  });

  it('VE02: breaks the line at empty buckets', () => {
    // Given
    const env = envelope([
      [10, 10, 10, 10],
      [Infinity, -Infinity, NaN, NaN],
      [20, 20, 20, 20],
    ]);
    const { ops, sink } = recorder();
    // When
    const points = buildEnvelopeLine(env, price, sink);
    // Then
    expect(points).toBe(2);
    expect(ops).toEqual(['M275,90', 'M295,80']);
  });

  it('VE03: emits nothing for a degenerate scale or no buckets', () => {
    // Given
    const { ops, sink } = recorder();
    // When / Then
    expect(buildEnvelopeLine(envelope([[1, 2, 1, 2]], NaN), price, sink)).toBe(
      0
    );
    expect(buildEnvelopeLine(envelope([]), price, sink)).toBe(0);
    expect(ops).toEqual([]);
  });
});
