/**
 * Test perspective table — PaneLayout (frames, hit tests, separator drag)
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                        |
 * |------|--------------------------------------------------------|----------------------|-------------------------------------------------|
 * | L1   | ratios 3:1, total 400                                  | Normal               | 300 / 100, tops 0 / 300                         |
 * | L2   | single pane                                            | Boundary (1)         | whole height                                    |
 * | L3   | no panes                                               | Boundary (empty)     | empty arrays                                    |
 * | L4   | a pane below its minimum                               | Boundary             | pinned to min, rest shared by ratio             |
 * | L5   | minimums exceed the total                              | Boundary (overflow)  | proportional to minimums, sum = total           |
 * | L6   | total 0 / NaN / −5 / ∞                                 | Invalid input        | all heights 0                                   |
 * | L7   | invalid ratios / minimums (NaN, 0, −1, missing)         | Invalid input        | ratio 1, min 0                                  |
 * | L8   | fractional split                                       | Boundary (rounding)  | integer tops, heights sum to total              |
 * | L9   | adding a pane                                          | Equivalence (stable) | others keep their relative proportions          |
 * | L10  | cascading pins (pin forces another pin)                | Boundary             | both pinned                                     |
 * | P1   | paneIndexAt inside / on boundary / above / below / NaN | Boundary             | index / clamped / −1                            |
 * | H1   | hitTestSeparator near / exact / outside slop / 1 pane  | Boundary             | index / −1                                      |
 * | H2   | hitTestSeparator two close separators / negative slop  | Boundary             | nearest / exact only                            |
 * | D1   | drag down 50                                           | Normal               | height moves between neighbors only             |
 * | D2   | drag beyond min above / below                          | Boundary             | clamped to minimums (≥ 1 dp)                    |
 * | D3   | drag index 0 / n / 1.5 / NaN dy / mismatched frame     | Invalid input        | ratios unchanged                                |
 * | D4   | minimums of the pair exceed its height                 | Abnormal             | ratios unchanged                                |
 */
import { describe, expect, it } from '@jest/globals';
import {
  computePaneLayout,
  dragSeparator,
  hitTestSeparator,
  paneIndexAt,
  type PaneLayoutSpec,
} from '../PaneLayout';

function spec(
  ratios: number[],
  minHeights: number[] = ratios.map(() => 0)
): PaneLayoutSpec {
  return { ids: ratios.map((_, i) => `p${i}`), ratios, minHeights };
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('computePaneLayout', () => {
  it('L1: proportional split', () => {
    // Given / When
    const f = computePaneLayout(spec([3, 1]), 400);
    // Then
    expect(f.heights).toEqual([300, 100]);
    expect(f.tops).toEqual([0, 300]);
    expect(f.total).toBe(400);
    expect(f.ids).toEqual(['p0', 'p1']);
  });

  it('L2 / L3: single pane and no panes', () => {
    // Given / When / Then
    expect(computePaneLayout(spec([2]), 250).heights).toEqual([250]);
    const empty = computePaneLayout(spec([]), 250);
    expect(empty.heights).toEqual([]);
    expect(empty.tops).toEqual([]);
  });

  it('L4: a pane below its minimum is pinned', () => {
    // Given: 9:1 of 400 would give 40 < 60
    // When
    const f = computePaneLayout(spec([9, 1], [0, 60]), 400);
    // Then
    expect(f.heights).toEqual([340, 60]);
  });

  it('L5: minimums larger than the total', () => {
    // Given / When
    const f = computePaneLayout(spec([1, 1], [300, 100]), 200);
    // Then
    expect(f.heights).toEqual([150, 50]);
    expect(sum(f.heights)).toBe(200);
  });

  it.each([0, NaN, -5, Infinity])('L6: invalid total %p', (total) => {
    // Given / When
    const f = computePaneLayout(spec([1, 1], [10, 10]), total);
    // Then
    expect(f.heights).toEqual([0, 0]);
    expect(f.total).toBe(0);
    expect(computePaneLayout(spec([1, 1]), total).heights).toEqual([0, 0]);
  });

  it('L7: invalid ratios and minimums', () => {
    // Given
    const s: PaneLayoutSpec = {
      ids: ['a', 'b', 'c', 'd'],
      ratios: [NaN, 0, -1],
      minHeights: [NaN, -4],
    };
    // When
    const f = computePaneLayout(s, 400);
    // Then
    expect(f.heights).toEqual([100, 100, 100, 100]);
  });

  it('L8: fractional splits round tops and keep the sum', () => {
    // Given / When
    const f = computePaneLayout(spec([1, 1, 1]), 100);
    // Then
    expect(f.tops).toEqual([0, 33, 67]);
    expect(f.heights).toEqual([33, 34, 33]);
    expect(f.tops.every(Number.isInteger)).toBe(true);
  });

  it('L9: adding a pane keeps the others proportional', () => {
    // Given
    const before = computePaneLayout(spec([3, 1]), 500);
    // When
    const after = computePaneLayout(spec([3, 1, 1]), 500);
    // Then
    expect((before.heights[0] as number) / (before.heights[1] as number)).toBe(
      3
    );
    expect((after.heights[0] as number) / (after.heights[1] as number)).toBe(3);
  });

  it('L10: cascading pins', () => {
    // Given: pinning p2 shrinks p1 below its minimum too
    // When
    const f = computePaneLayout(spec([10, 1, 1], [0, 45, 100]), 400);
    // Then
    expect(f.heights).toEqual([255, 45, 100]);
  });
});

describe('paneIndexAt / hitTestSeparator', () => {
  const frame = computePaneLayout(spec([2, 1, 1]), 400);

  it('P1: pane under y', () => {
    // Given / When / Then
    expect(paneIndexAt(frame, 10)).toBe(0);
    expect(paneIndexAt(frame, 200)).toBe(1);
    expect(paneIndexAt(frame, 299.9)).toBe(1);
    expect(paneIndexAt(frame, 300)).toBe(2);
    expect(paneIndexAt(frame, -50)).toBe(0);
    expect(paneIndexAt(frame, 900)).toBe(2);
    expect(paneIndexAt(frame, NaN)).toBe(-1);
    expect(paneIndexAt(computePaneLayout(spec([]), 10), 5)).toBe(-1);
  });

  it('H1: separator hit test', () => {
    // Given / When / Then
    expect(hitTestSeparator(frame, 205, 10)).toBe(1);
    expect(hitTestSeparator(frame, 300, 10)).toBe(2);
    expect(hitTestSeparator(frame, 250, 10)).toBe(-1);
    expect(hitTestSeparator(computePaneLayout(spec([1]), 100), 0, 10)).toBe(-1);
  });

  it('H2: nearest separator wins, negative slop means exact', () => {
    // Given
    const tight = computePaneLayout(spec([10, 1, 1], [0, 0, 0]), 120);
    // When / Then: separators at 100 and 110
    expect(hitTestSeparator(tight, 107, 20)).toBe(2);
    expect(hitTestSeparator(tight, 103, 20)).toBe(1);
    expect(hitTestSeparator(tight, 100, -3)).toBe(1);
    expect(hitTestSeparator(tight, 101, -3)).toBe(-1);
  });
});

describe('dragSeparator', () => {
  const s = spec([2, 1, 1], [50, 40, 40]);
  const start = computePaneLayout(s, 400);

  it('D1: moves height between the neighbors only', () => {
    // Given / When
    const ratios = dragSeparator(s, start, 2, 50);
    const f = computePaneLayout({ ...s, ratios }, 400);
    // Then
    expect(f.heights).toEqual([200, 150, 50]);
    expect(sum(ratios)).toBeCloseTo(4, 12);
    expect(ratios[0]).toBe(2);
  });

  it('D2: clamps to the minimums', () => {
    // Given / When
    const down = computePaneLayout(
      { ...s, ratios: dragSeparator(s, start, 2, 999) },
      400
    );
    const up = computePaneLayout(
      { ...s, ratios: dragSeparator(s, start, 1, -999) },
      400
    );
    const zeroMin = spec([1, 1]);
    const f0 = computePaneLayout(zeroMin, 100);
    const r0 = dragSeparator(zeroMin, f0, 1, 500);
    // Then
    expect(down.heights).toEqual([200, 160, 40]);
    expect(up.heights).toEqual([50, 250, 100]);
    expect(r0[1]).toBeGreaterThan(0);
    expect(computePaneLayout({ ...zeroMin, ratios: r0 }, 100).heights).toEqual([
      99, 1,
    ]);
  });

  it.each([
    [0, 10],
    [3, 10],
    [1.5, 10],
    [1, NaN],
  ])('D3: invalid index %p / dy %p', (index, dy) => {
    // Given / When
    const ratios = dragSeparator(s, start, index, dy);
    // Then
    expect(ratios).toEqual([2, 1, 1]);
  });

  it('D3b: mismatched start frame and invalid ratios', () => {
    // Given
    const other = computePaneLayout(spec([1, 1]), 400);
    // When / Then
    expect(dragSeparator(s, other, 1, 10)).toEqual([2, 1, 1]);
    expect(dragSeparator(spec([NaN, 1]), other, 1, 0)).toEqual([1, 1]);
  });

  it('D4: pair minimums exceed its height', () => {
    // Given
    const tight = spec([1, 1], [300, 300]);
    const f = computePaneLayout(tight, 200);
    // When / Then
    expect(dragSeparator(tight, f, 1, 20)).toEqual([1, 1]);
  });
});
