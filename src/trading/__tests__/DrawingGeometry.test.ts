/**
 * Test perspective table — DrawingGeometry
 *
 * | Case | Input / Precondition                                    | Perspective        | Expected                               |
 * |------|---------------------------------------------------------|--------------------|----------------------------------------|
 * | TX1  | timeToX of a bar time / future slot                     | Equivalence        | bar center x / extrapolated x          |
 * | TX2  | timeToX empty series / NaN time                         | Invalid / empty    | NaN                                    |
 * | TX3  | timeToX far future (1e15 ms)                            | Boundary (huge)    | clamped finite coordinate              |
 * | PA1  | projectAnchors two anchors                              | Equivalence        | [x, y, x, y]                           |
 * | PA2  | projectAnchors NaN price / empty data                   | Invalid            | false                                  |
 * | PA3  | projectAnchors empty anchor list                        | Boundary (empty)   | true, out untouched                    |
 * | CS1  | clipSegment fully inside / crossing / diagonal          | Equivalence        | unchanged / clipped to the rect        |
 * | CS2  | clipSegment outside (left, above, parallel outside)     | Equivalence (miss) | false                                  |
 * | CS3  | clipSegment degenerate point inside / outside           | Boundary (0 len)   | true / false                           |
 * | CS4  | clipSegment NaN / ∞ ends                                | Invalid            | false                                  |
 * | CS5  | clipSegment reversed direction                          | Equivalence        | clipped, direction kept                |
 * | FP1  | fibPrice levels 0 / 0.5 / 1                             | Equivalence/Bound. | second / mid / first                   |
 * | CY1  | crispY pr 2 / pr 0 / NaN                                | Equivalence/Inval. | pixel center / pr 1 fallback           |
 * | SG1  | createSegment                                           | Equivalence        | zeroed segment                         |
 */
import { describe, expect, it } from '@jest/globals';
import {
  clipSegment,
  createSegment,
  crispY,
  fibPrice,
  projectAnchors,
  timeToX,
} from '../DrawingGeometry';
import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import type { TimeScaleState } from '../../viewport/TimeScale';
import { columns, minuteBars, MIN, T0 } from './fixtures';

const five = minuteBars(5);
// x(i) = 100 − (4.5 − i) × 10 → bar 4 at 95, bar 0 at 55.
const time: TimeScaleState = {
  width: 100,
  barSpacing: 10,
  rightOffset: 0,
  barCount: 5,
};
// y = 100 − price.
const price: PriceScaleSnapshot = {
  mode: 'linear',
  top: 0,
  height: 100,
  min: 0,
  max: 100,
};

describe('timeToX', () => {
  it('TX1: bar and future slot times', () => {
    // Given / When / Then
    expect(timeToX(five, time, T0 + 4 * MIN, MIN)).toBe(95);
    expect(timeToX(five, time, T0 + 6 * MIN, MIN)).toBe(115);
  });

  it.each([
    [columns([]), T0],
    [five, NaN],
  ])('TX2: no data / NaN time → NaN (%#)', (series, t) => {
    // Given / When / Then
    expect(timeToX(series, time, t, MIN)).toBeNaN();
  });

  it('TX3: a far future time is clamped to a finite coordinate', () => {
    // Given / When
    const x = timeToX(five, time, 1e15, 1);
    // Then
    expect(Number.isFinite(x)).toBe(true);
  });
});

describe('projectAnchors', () => {
  it('PA1: projects every anchor', () => {
    // Given
    const out: number[] = [];
    // When
    const ok = projectAnchors(
      five,
      time,
      price,
      MIN,
      [T0, 30, T0 + 4 * MIN, 70],
      out
    );
    // Then
    expect(ok).toBe(true);
    expect(out).toEqual([55, 70, 95, 30]);
  });

  it.each([
    [five, [T0, NaN]],
    [columns([]), [T0, 50]],
  ])('PA2: a non-finite point → false (%#)', (series, anchors) => {
    // Given / When / Then
    expect(projectAnchors(series, time, price, MIN, anchors, [])).toBe(false);
  });

  it('PA3: no anchors → true', () => {
    // Given
    const out = new Float64Array(2);
    // When / Then
    expect(projectAnchors(five, time, price, MIN, [], out)).toBe(true);
    expect(Array.from(out)).toEqual([0, 0]);
  });
});

describe('clipSegment', () => {
  const clip = (
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): number[] | null => {
    const out = createSegment();
    return clipSegment(x0, y0, x1, y1, 0, 0, 100, 50, out)
      ? [out.x0, out.y0, out.x1, out.y1]
      : null;
  };

  it('CS1: inside, crossing and diagonal segments', () => {
    // Given / When / Then
    expect(clip(10, 10, 90, 40)).toEqual([10, 10, 90, 40]);
    expect(clip(-100, 25, 200, 25)).toEqual([0, 25, 100, 25]);
    expect(clip(-50, -25, 150, 75)).toEqual([0, 0, 100, 50]);
  });

  it.each([
    [-20, 10, -5, 40],
    [10, -30, 90, -1],
    [-10, 60, 110, 60],
    [150, 10, 120, 60],
    [110, 10, 150, 20],
    [90, 60, 120, 40],
  ])('CS2: (%p, %p) → (%p, %p) misses', (x0, y0, x1, y1) => {
    // Given / When / Then
    expect(clip(x0, y0, x1, y1)).toBeNull();
  });

  it('CS3: a zero-length segment', () => {
    // Given / When / Then
    expect(clip(20, 20, 20, 20)).toEqual([20, 20, 20, 20]);
    expect(clip(-1, 20, -1, 20)).toBeNull();
  });

  it.each([
    [NaN, 0, 1, 1],
    [0, Infinity, 1, 1],
    [0, 0, -Infinity, 1],
    [0, 0, 1, NaN],
  ])('CS4: non-finite ends → false (%#)', (x0, y0, x1, y1) => {
    // Given / When / Then
    expect(clip(x0, y0, x1, y1)).toBeNull();
  });

  it('CS5: a reversed segment keeps its direction', () => {
    // Given / When / Then
    expect(clip(200, 25, -100, 25)).toEqual([100, 25, 0, 25]);
  });
});

describe('fibPrice / crispY / createSegment', () => {
  it('FP1: level 0 is the second anchor, 1 the first', () => {
    // Given / When / Then
    expect(fibPrice(200, 100, 0)).toBe(100);
    expect(fibPrice(200, 100, 0.5)).toBe(150);
    expect(fibPrice(200, 100, 1)).toBe(200);
  });

  it('CY1: pixel centers; invalid ratios fall back to 1', () => {
    // Given / When / Then
    expect(crispY(10.2, 2)).toBe(10.25);
    expect(crispY(10.2, 0)).toBe(10.5);
    expect(crispY(10.2, NaN)).toBe(10.5);
  });

  it('SG1: a fresh segment is zeroed', () => {
    // Given / When / Then
    expect(createSegment()).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });
});
