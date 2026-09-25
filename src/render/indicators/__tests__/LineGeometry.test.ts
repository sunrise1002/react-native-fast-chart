/**
 * Test perspective table — indicator line / band geometry
 *
 * Scales: x(i) = 10·i (10 bars, spacing 10), y(p) = 100 − p.
 *
 * | Case | Input / Precondition                               | Perspective        | Expected                                   |
 * |------|----------------------------------------------------|--------------------|--------------------------------------------|
 * | L1   | finite values over the full range                  | Normal             | one moveTo + lineTos, point count          |
 * | L2   | warm-up NaN prefix and a NaN gap                   | Abnormal           | new moveTo after each gap                  |
 * | L3   | fractional / out-of-range start–end                | Boundary           | clamped to [ceil(start), floor(end)]       |
 * | L4   | end < start / empty values / length 0              | Boundary (empty)   | 0 points, no calls                         |
 * | L5   | NaN start or end                                   | Invalid            | 0                                          |
 * | L6   | ±Infinity value / 1e300 value                      | Abnormal           | gap / y clamped to ±1e6                    |
 * | L7   | length shorter than values                         | Boundary           | stops at length − 1                        |
 * | F1   | band fully finite                                  | Normal             | 1 polygon, upper forward, lower back, close|
 * | F2   | band with a NaN gap in lower                       | Abnormal           | 2 polygons                                 |
 * | F3   | band all NaN / NaN range / empty                   | Boundary           | 0 polygons                                 |
 * | F4   | single drawable bar                                | Boundary (1)       | degenerate polygon (moveTo, lineTo, close) |
 */
import { describe, expect, it } from '@jest/globals';
import type { PriceScaleSnapshot } from '../../../viewport/PriceScale';
import type { TimeScaleState } from '../../../viewport/TimeScale';
import {
  buildBandFill,
  buildLineGeometry,
  MAX_ABS_COORDINATE,
} from '../LineGeometry';

const TIME: TimeScaleState = {
  width: 100,
  barSpacing: 10,
  rightOffset: 0.5,
  barCount: 10,
};
const PRICE: PriceScaleSnapshot = {
  mode: 'linear',
  top: 0,
  height: 100,
  min: 0,
  max: 100,
};

function recorder() {
  const ops: string[] = [];
  return {
    ops,
    moveTo: (x: number, y: number) => ops.push(`M${x},${y}`),
    lineTo: (x: number, y: number) => ops.push(`L${x},${y}`),
    close: () => ops.push('Z'),
  };
}

function line(values: number[], start = 0, end = 9, length = values.length) {
  const sink = recorder();
  const points = buildLineGeometry(
    values,
    length,
    start,
    end,
    TIME,
    PRICE,
    sink
  );
  return { points, ops: sink.ops };
}

describe('buildLineGeometry', () => {
  it('L1: one polyline', () => {
    // Given / When
    const { points, ops } = line([10, 20, 30]);
    // Then
    expect(points).toBe(3);
    expect(ops).toEqual(['M0,90', 'L10,80', 'L20,70']);
  });

  it('L2: NaN breaks the line', () => {
    // Given / When
    const { points, ops } = line([NaN, NaN, 10, 20, NaN, 30, 40]);
    // Then
    expect(points).toBe(4);
    expect(ops).toEqual(['M20,90', 'L30,80', 'M50,70', 'L60,60']);
  });

  it('L3: clamps the range', () => {
    // Given
    const v = [1, 2, 3, 4, 5];
    // When / Then
    expect(line(v, 0.5, 2.5).ops).toEqual(['M10,98', 'L20,97']);
    expect(line(v, -10, 100).points).toBe(5);
  });

  it('L4: empty inputs', () => {
    // Given / When / Then
    expect(line([1, 2, 3], 2, 1)).toEqual({ points: 0, ops: [] });
    expect(line([])).toEqual({ points: 0, ops: [] });
    expect(line([1, 2], 0, 9, 0)).toEqual({ points: 0, ops: [] });
  });

  it('L5: NaN range', () => {
    // Given / When / Then
    expect(line([1, 2], NaN, 1).points).toBe(0);
    expect(line([1, 2], 0, NaN).points).toBe(0);
  });

  it('L6: infinite and huge values', () => {
    // Given / When
    const inf = line([1, Infinity, 2, -Infinity]);
    const huge = line([1e300, -1e300]);
    // Then
    expect(inf.ops).toEqual(['M0,99', 'M20,98']);
    expect(huge.ops).toEqual([
      `M0,${-MAX_ABS_COORDINATE}`,
      `L10,${MAX_ABS_COORDINATE}`,
    ]);
  });

  it('L7: respects length', () => {
    // Given / When / Then
    expect(line([1, 2, 3, 4], 0, 9, 2).points).toBe(2);
  });
});

describe('buildBandFill', () => {
  function band(upper: number[], lower: number[], start = 0, end = 9) {
    const sink = recorder();
    const polygons = buildBandFill(
      upper,
      lower,
      upper.length,
      start,
      end,
      TIME,
      PRICE,
      sink
    );
    return { polygons, ops: sink.ops };
  }

  it('F1: one polygon', () => {
    // Given / When
    const { polygons, ops } = band([20, 30], [10, 15]);
    // Then
    expect(polygons).toBe(1);
    expect(ops).toEqual(['M0,80', 'L10,70', 'L10,85', 'L0,90', 'Z']);
  });

  it('F2: gaps split polygons', () => {
    // Given / When
    const { polygons, ops } = band(
      [NaN, 20, 30, 40, 50],
      [NaN, 10, NaN, 30, 40]
    );
    // Then
    expect(polygons).toBe(2);
    expect(ops.filter((o) => o === 'Z')).toHaveLength(2);
    expect(ops[0]).toBe('M10,80');
  });

  it('F3: nothing drawable', () => {
    // Given / When / Then
    expect(band([NaN, NaN], [1, 2]).polygons).toBe(0);
    expect(band([1, 2], [1, 2], NaN, 1).polygons).toBe(0);
    expect(band([1, 2], [1, 2], 0, NaN).polygons).toBe(0);
    expect(band([], []).polygons).toBe(0);
  });

  it('F4: single bar', () => {
    // Given / When
    const { polygons, ops } = band([20], [10]);
    // Then
    expect(polygons).toBe(1);
    expect(ops).toEqual(['M0,80', 'L0,90', 'Z']);
  });
});
