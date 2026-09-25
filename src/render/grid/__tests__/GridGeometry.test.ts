/**
 * Test perspective table — GridGeometry
 *
 * Plot: width 100, spacing 10, barCount 10 (right edge index 9.5),
 * price top 0 / height 100 / [0, 100].
 *
 * | Case | Input / Precondition                              | Perspective        | Expected                              |
 * |------|---------------------------------------------------|--------------------|---------------------------------------|
 * | GR1  | price step 25                                     | Equivalence        | 5 snapped horizontal lines            |
 * | GR2  | bar step 2                                        | Equivalence        | lines on bars 0,2,4,6,8               |
 * | GR3  | pixel ratio 2                                     | Equivalence        | 2 px lines on 0.5 dp grid             |
 * | GR4  | top 10                                            | Equivalence        | shifted by 10                         |
 * | GR5  | default nice step fns                             | Equivalence        | lines on step multiples, all finite   |
 * | GR6  | tiny step → cap; maxLines 0 / -1 / 1              | Boundary           | 200 / 0 / 0 / 1 per direction         |
 * | GR7  | width 0 / NaN / ∞, top NaN                        | Invalid            | 0 lines                               |
 * | GR8  | height 0                                          | Boundary           | 0 lines                               |
 * | GR9  | price step NaN / 0 / ∞ / -5; min == max           | Invalid            | no horizontal, vertical still drawn   |
 * | GR10 | bar step 0.5 / NaN / ∞; spacing 0 / NaN; offset NaN | Invalid          | no vertical, horizontal still drawn   |
 */
import { describe, expect, it } from '@jest/globals';
import type { PriceScaleSnapshot } from '../../../viewport/PriceScale';
import type { TimeScaleState } from '../../../viewport/TimeScale';
import {
  buildGridGeometry,
  DEFAULT_GRID_OPTIONS,
  type BarStepFn,
  type GridOptions,
  type PriceStepFn,
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
const step25: PriceStepFn = () => 25;
const step2: BarStepFn = () => 2;

function run(
  time: Partial<TimeScaleState> = {},
  price: Partial<PriceScaleSnapshot> = {},
  options: Partial<GridOptions> = {},
  priceStep?: PriceStepFn,
  barStep?: BarStepFn
) {
  const lines: Line[] = [];
  // `+ 0` folds Math.round's -0 into 0 for readable equality.
  const count = buildGridGeometry(
    { ...TIME, ...time },
    { ...PRICE, ...price },
    { ...DEFAULT_GRID_OPTIONS, ...options },
    {
      line: (horizontal, x, y, w, h, value) =>
        lines.push({ horizontal, x: x + 0, y: y + 0, w, h, value: value + 0 }),
    },
    priceStep,
    barStep
  );
  return {
    count,
    lines,
    h: lines.filter((l) => l.horizontal),
    v: lines.filter((l) => !l.horizontal),
  };
}

describe('buildGridGeometry', () => {
  it('GR1: emits snapped horizontal lines at price steps', () => {
    // Given / When
    const { h } = run({}, {}, {}, step25, step2);
    // Then
    expect(h.map((l) => [l.value, l.y])).toEqual([
      [0, 100],
      [25, 75],
      [50, 50],
      [75, 25],
      [100, 0],
    ]);
    expect(h[0]).toMatchObject({ x: 0, w: 100, h: 1 });
  });

  it('GR2: emits vertical lines on bar-step multiples', () => {
    // Given / When
    const { v, count } = run({}, {}, {}, step25, step2);
    // Then: x = 100 - (9.5 - i) * 10 = 5 + 10i
    expect(v.map((l) => [l.value, l.x])).toEqual([
      [0, 5],
      [2, 25],
      [4, 45],
      [6, 65],
      [8, 85],
    ]);
    expect(v[0]).toMatchObject({ y: 0, w: 1, h: 100 });
    expect(count).toBe(10);
  });

  it('GR3: snaps to half dp at pixel ratio 2', () => {
    // Given / When
    const { lines } = run({}, {}, { pixelRatio: 2 }, step25, step2);
    // Then: 2 px lines centered on the value → edge at v - 0.5
    expect(lines.find((l) => l.value === 25 && l.horizontal)).toMatchObject({
      y: 74.5,
      h: 1,
    });
    expect(lines.find((l) => l.value === 2 && !l.horizontal)).toMatchObject({
      x: 24.5,
      w: 1,
    });
  });

  it('GR4: offsets lines by the pane top', () => {
    // Given / When
    const { h, v } = run({}, { top: 10 }, {}, step25, step2);
    // Then
    expect(h.map((l) => l.y)).toEqual([110, 85, 60, 35, 10]);
    expect(v[0]).toMatchObject({ y: 10 });
  });

  it('GR5: uses nice steps by default', () => {
    // Given: 100 over 600 px / 60 → step 10; 10 dp bars / 90 → 10 bars
    // When
    const { h, v } = run({ width: 400, barCount: 100 }, { height: 600 });
    // Then
    expect(h).toHaveLength(11);
    expect(h.every((l) => l.value % 10 === 0)).toBe(true);
    expect(v.map((l) => l.value)).toEqual([60, 70, 80, 90]);
  });

  it.each([
    [undefined, 200],
    [0, 0],
    [-1, 0],
    [1, 1],
  ])('GR6: maxLines %p caps each direction at %p', (maxLines, cap) => {
    // Given: steps far too small
    const opts = maxLines === undefined ? {} : { maxLines };
    // When
    const { h, v } = run(
      { barCount: 1e6, width: 1e5 },
      {},
      opts,
      () => 1e-3,
      () => 1
    );
    // Then
    expect(h).toHaveLength(cap);
    expect(v).toHaveLength(cap);
  });

  it.each([
    ['width 0', { width: 0 }, {}],
    ['width NaN', { width: NaN }, {}],
    ['width ∞', { width: Infinity }, {}],
    ['top NaN', {}, { top: NaN }],
    ['height 0', {}, { height: 0 }],
  ])('GR7/GR8: %s → no lines', (_label, time, price) => {
    // Given / When / Then
    expect(run(time, price, {}, step25, step2).count).toBe(0);
  });

  it.each([
    ['step NaN', {}, () => NaN],
    ['step 0', {}, () => 0],
    ['step ∞', {}, () => Infinity],
    ['step -5', {}, () => -5],
    ['min == max', { min: 50, max: 50 }, step25],
    ['max NaN', { max: NaN }, step25],
  ] as [string, Partial<PriceScaleSnapshot>, PriceStepFn][])(
    'GR9: %s → no horizontal lines',
    (_label, price, priceStep) => {
      // Given / When
      const { h, v } = run({}, price, {}, priceStep, step2);
      // Then
      expect(h).toHaveLength(0);
      expect(v).toHaveLength(5);
    }
  );

  it.each([
    ['bar step 0.5', {}, () => 0.5],
    ['bar step NaN', {}, () => NaN],
    ['bar step ∞', {}, () => Infinity],
    ['spacing 0', { barSpacing: 0 }, step2],
    ['spacing NaN', { barSpacing: NaN }, step2],
    ['spacing ∞', { barSpacing: Infinity }, step2],
    ['rightOffset NaN', { rightOffset: NaN }, step2],
  ] as [string, Partial<TimeScaleState>, BarStepFn][])(
    'GR10: %s → no vertical lines',
    (_label, time, barStep) => {
      // Given / When
      const { h, v } = run(time, {}, {}, step25, barStep);
      // Then
      expect(v).toHaveLength(0);
      expect(h).toHaveLength(5);
    }
  );
});
