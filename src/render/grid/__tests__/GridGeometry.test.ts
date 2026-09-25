/**
 * Test perspective table — GridGeometry (lines from axis ticks)
 *
 * Plot: width 100, spacing 10, barCount 10 (x(i) = 5 + 10 i),
 * price top 0 / height 100 / [0, 100].
 *
 * | Case | Input / Precondition                              | Perspective        | Expected                              |
 * |------|---------------------------------------------------|--------------------|---------------------------------------|
 * | GR1  | price ticks 0/25/50/75/100                        | Equivalence        | 5 snapped horizontal lines            |
 * | GR2  | time ticks at bars 0/4/8                          | Equivalence        | vertical lines at x 5/45/85           |
 * | GR3  | pixel ratio 2                                     | Equivalence        | 2 px lines on a 0.5 dp grid           |
 * | GR4  | top 10                                            | Equivalence        | shifted by 10                         |
 * | GR5  | tick exactly on the pane edges (0 / 100)          | Boundary           | kept                                  |
 * | GR6  | price ticks outside the pane (-1 / 101)           | Boundary           | skipped                               |
 * | GR7  | time ticks off-screen (-1 → x -5, 10 → x 105)     | Boundary           | skipped                               |
 * | GR8  | NaN price tick / NaN time tick                    | Invalid            | skipped                               |
 * | GR9  | width 0 / NaN / ∞; height 0 / ∞; top NaN          | Invalid            | 0 lines                               |
 * | GR10 | min == max / max NaN                              | Invalid            | no horizontal, vertical still drawn   |
 * | GR11 | count 0 for both                                  | Boundary (empty)   | 0 lines                               |
 * | GR12 | DEFAULT_GRID_OPTIONS                              | Equivalence        | 1 dp at pixel ratio 1, frozen         |
 */
import { describe, expect, it } from '@jest/globals';
import type { PriceScaleSnapshot } from '../../../viewport/PriceScale';
import type { TimeScaleState } from '../../../viewport/TimeScale';
import {
  buildGridGeometry,
  DEFAULT_GRID_OPTIONS,
  type GridOptions,
} from '../GridGeometry';

interface Line {
  horizontal: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
}

const TIME: TimeScaleState = {
  width: 100,
  barSpacing: 10,
  rightOffset: 0,
  barCount: 10,
};
const PRICE: PriceScaleSnapshot = {
  mode: 'linear',
  top: 0,
  height: 100,
  min: 0,
  max: 100,
};

function run(
  prices: number[],
  bars: number[],
  time: Partial<TimeScaleState> = {},
  price: Partial<PriceScaleSnapshot> = {},
  options: GridOptions = DEFAULT_GRID_OPTIONS
) {
  const lines: Line[] = [];
  const count = buildGridGeometry(
    { ...TIME, ...time },
    { ...PRICE, ...price },
    { values: prices, count: prices.length },
    { positions: bars, count: bars.length },
    options,
    {
      line(horizontal, x, y, w, h, value) {
        lines.push({ horizontal, x, y, w, h, value });
      },
    }
  );
  return {
    count,
    lines,
    h: lines.filter((l) => l.horizontal),
    v: lines.filter((l) => !l.horizontal),
  };
}

describe('buildGridGeometry', () => {
  it('GR1: emits snapped horizontal lines at the price ticks', () => {
    // Given / When
    const { count, h } = run([0, 25, 50, 75, 100], []);
    // Then: y = 100 - value, snapped to round(y - 0.5)
    expect(count).toBe(5);
    expect(h.map((l) => l.y + 0)).toEqual([100, 75, 50, 25, 0]);
    expect(h.map((l) => l.value)).toEqual([0, 25, 50, 75, 100]);
    expect(h.every((l) => l.x === 0 && l.w === 100 && l.h === 1)).toBe(true);
  });

  it('GR2: emits vertical lines at the time ticks', () => {
    // Given / When
    const { v } = run([], [0, 4, 8]);
    // Then: x(i) = 5 + 10 i → snapped round(x - 0.5)
    expect(v.map((l) => l.x)).toEqual([5, 45, 85]);
    expect(v.map((l) => l.value)).toEqual([0, 4, 8]);
    expect(v.every((l) => l.y === 0 && l.w === 1 && l.h === 100)).toBe(true);
  });

  it('GR3: snaps to half dp at pixel ratio 2', () => {
    // Given / When
    const { h, v } = run([33.3], [2], {}, {}, { lineWidth: 1, pixelRatio: 2 });
    // Then: 2 px wide = 1 dp, positions multiples of 0.5
    expect(h[0]?.h).toBe(1);
    expect(((h[0]?.y ?? NaN) * 2) % 1).toBe(0);
    expect(((v[0]?.x ?? NaN) * 2) % 1).toBe(0);
  });

  it('GR4: offsets lines by the pane top', () => {
    // Given / When
    const { h, v } = run([100], [1], {}, { top: 10 });
    // Then
    expect(h[0]?.y).toBe(10);
    expect(v[0]?.y).toBe(10);
  });

  it('GR5: keeps ticks exactly on the pane edges', () => {
    // Given / When
    const { h } = run([0, 100], []);
    // Then
    expect(h).toHaveLength(2);
  });

  it.each([[-1], [101], [-1e9]])(
    'GR6: skips price tick %p outside the pane',
    (value) => {
      // Given / When
      const { count } = run([value], []);
      // Then
      expect(count).toBe(0);
    }
  );

  it.each([[-1], [10], [1e6]])('GR7: skips off-screen bar %p', (bar) => {
    // Given / When
    const { count } = run([], [bar]);
    // Then
    expect(count).toBe(0);
  });

  it('GR8: skips NaN ticks', () => {
    // Given / When
    const { count } = run([NaN, 50], [NaN, 3]);
    // Then
    expect(count).toBe(2);
  });

  it.each<[string, Partial<TimeScaleState>, Partial<PriceScaleSnapshot>]>([
    ['width 0', { width: 0 }, {}],
    ['width NaN', { width: NaN }, {}],
    ['width ∞', { width: Infinity }, {}],
    ['height 0', {}, { height: 0 }],
    ['height ∞', {}, { height: Infinity }],
    ['top NaN', {}, { top: NaN }],
  ])('GR9: %s → 0 lines', (_label, time, price) => {
    // Given / When
    const { count, lines } = run([50], [3], time, price);
    // Then
    expect(count).toBe(0);
    expect(lines).toHaveLength(0);
  });

  it.each<[string, Partial<PriceScaleSnapshot>]>([
    ['min == max', { min: 50, max: 50 }],
    ['max NaN', { max: NaN }],
  ])('GR10: %s → no horizontal lines', (_label, price) => {
    // Given / When
    const { h, v } = run([50], [3], {}, price);
    // Then
    expect(h).toHaveLength(0);
    expect(v).toHaveLength(1);
  });

  it('GR11: returns 0 for empty tick sets', () => {
    // Given / When / Then
    expect(run([], []).count).toBe(0);
  });

  it('GR12: default options are 1 dp at pixel ratio 1 and frozen', () => {
    // Given / When / Then
    expect(DEFAULT_GRID_OPTIONS).toEqual({ lineWidth: 1, pixelRatio: 1 });
    expect(Object.isFrozen(DEFAULT_GRID_OPTIONS)).toBe(true);
  });
});
