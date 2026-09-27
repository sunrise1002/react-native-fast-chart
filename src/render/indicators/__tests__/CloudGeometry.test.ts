/**
 * Test perspective table — buildCloudFill / buildPointGeometry
 *
 * Scale: x(i) = 10·i, y(v) = 100 − v.
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                     |
 * |------|--------------------------------------------------------|----------------------|----------------------------------------------|
 * | CL1  | a above b everywhere, sign +1 / −1                     | Normal               | one polygon / none                           |
 * | CL2  | a crosses below b between bars 0 and 1                 | Normal (crossing)    | + side ends, − side starts at (5, 50)        |
 * | CL3  | a = b                                                  | Boundary (0 gap)     | belongs to the + side                        |
 * | CL4  | NaN edge value mid-series                              | Abnormal             | run split in two, no crossing extension      |
 * | CL5  | range [0, 0] next to a crossing                        | Boundary             | run still extended to the crossing           |
 * | CL6  | NaN start / end, empty, length < arrays                | Abnormal / Boundary  | 0 polygons / clamped to length               |
 * | PT1  | values with a NaN, radius 2                            | Normal / Abnormal    | one circle per finite value                  |
 * | PT2  | radius 0 / NaN, NaN start / end                        | Boundary / Invalid   | 0 circles                                    |
 * | PT3  | end past the data, fractional start                    | Boundary             | clamped to [ceil(start), length − 1]         |
 */
import { describe, expect, it } from '@jest/globals';
import type { PriceScaleSnapshot } from '../../../viewport/PriceScale';
import type { TimeScaleState } from '../../../viewport/TimeScale';
import { buildCloudFill } from '../CloudGeometry';
import { buildPointGeometry } from '../LineGeometry';

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

function cloud(
  a: number[],
  b: number[],
  sign: number,
  start = 0,
  end = 9,
  length = a.length
) {
  const ops: string[] = [];
  const polygons = buildCloudFill(a, b, length, start, end, TIME, PRICE, sign, {
    moveTo: (x, y) => ops.push(`M${x},${y}`),
    lineTo: (x, y) => ops.push(`L${x},${y}`),
    close: () => ops.push('Z'),
  });
  return { polygons, ops };
}

function dots(
  values: number[],
  radius: number,
  start = 0,
  end = 9,
  length = values.length
) {
  const circles: string[] = [];
  const count = buildPointGeometry(
    values,
    length,
    start,
    end,
    TIME,
    PRICE,
    radius,
    { addCircle: (x, y, r) => circles.push(`${x},${y},${r}`) }
  );
  return { count, circles };
}

describe('buildCloudFill', () => {
  it('CL1: a above b fills only the + side', () => {
    // Given
    const a = [60, 60, 60];
    const b = [40, 40, 40];
    // When
    const up = cloud(a, b, 1);
    const down = cloud(a, b, -1);
    // Then
    expect(up.polygons).toBe(1);
    expect(up.ops).toEqual([
      'M0,40',
      'L10,40',
      'L20,40',
      'L20,60',
      'L10,60',
      'L0,60',
      'Z',
    ]);
    expect(down).toEqual({ polygons: 0, ops: [] });
  });

  it('CL2: runs meet at the crossing point', () => {
    // Given
    const a = [60, 40];
    const b = [40, 60];
    // When
    const up = cloud(a, b, 1);
    const down = cloud(a, b, -1);
    // Then
    expect(up.ops).toEqual(['M0,40', 'L5,50', 'L0,60', 'Z']);
    expect(down.ops).toEqual(['M5,50', 'L10,60', 'L10,40', 'Z']);
  });

  it('CL3: equal edges belong to the + side', () => {
    // Given / When
    const up = cloud([50, 50], [50, 50], 1);
    const down = cloud([50, 50], [50, 50], -1);
    // Then
    expect(up.polygons).toBe(1);
    expect(down.polygons).toBe(0);
  });

  it('CL4: a NaN value splits the run', () => {
    // Given / When
    const r = cloud([60, NaN, 60], [40, 40, 40], 1);
    // Then
    expect(r.polygons).toBe(2);
    expect(r.ops).toEqual(['M0,40', 'L0,60', 'Z', 'M20,40', 'L20,60', 'Z']);
  });

  it('CL5: a clipped range still reaches the crossing', () => {
    // Given / When
    const r = cloud([60, 40], [40, 60], 1, 0, 0);
    // Then
    expect(r.ops).toEqual(['M0,40', 'L5,50', 'L0,60', 'Z']);
  });

  it.each([
    [NaN, 9, 3],
    [0, NaN, 3],
    [0, 9, 0],
  ])('CL6: start %p end %p length %p draws nothing', (start, end, length) => {
    // Given / When
    const r = cloud([60, 60, 60], [40, 40, 40], 1, start, end, length);
    // Then
    expect(r).toEqual({ polygons: 0, ops: [] });
  });

  it('CL6: length shorter than the arrays clamps', () => {
    // Given / When
    const r = cloud([60, 60, 60], [40, 40, 40], 1, 0, 9, 1);
    // Then
    expect(r.ops).toEqual(['M0,40', 'L0,60', 'Z']);
  });
});

describe('buildPointGeometry', () => {
  it('PT1: one circle per finite value', () => {
    // Given / When
    const r = dots([10, NaN, 30, Infinity], 2);
    // Then
    expect(r).toEqual({ count: 2, circles: ['0,90,2', '20,70,2'] });
  });

  it.each([
    [0, 0, 9],
    [NaN, 0, 9],
    [-1, 0, 9],
    [2, NaN, 9],
    [2, 0, NaN],
  ])('PT2: radius %p start %p end %p draws nothing', (radius, start, end) => {
    // Given / When / Then
    expect(dots([10, 20], radius, start, end)).toEqual({
      count: 0,
      circles: [],
    });
  });

  it('PT3: clamps the range to the data', () => {
    // Given / When
    const r = dots([10, 20, 30], 1, 0.5, 99, 2);
    // Then
    expect(r.circles).toEqual(['10,80,1']);
  });
});
