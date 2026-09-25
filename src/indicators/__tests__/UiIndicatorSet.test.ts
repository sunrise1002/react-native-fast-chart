/**
 * Test perspective table — UiIndicatorSet (JS → UI transfer)
 *
 * | Case | Input / Precondition                                  | Perspective       | Expected                                        |
 * |------|-------------------------------------------------------|-------------------|-------------------------------------------------|
 * | K1   | full update                                           | Normal            | full payload, output-major values               |
 * | K2   | tail update (from = length − 1)                       | Normal            | tail payload with 1 value per output            |
 * | K3   | tail of exactly 512 / 513 bars                        | Boundary (max±1)  | patch / full                                    |
 * | K4   | from > length (negative tail) / NaN from              | Invalid           | full                                            |
 * | K5   | removed update                                        | Normal            | removed payload, empty values                   |
 * | U1   | apply full then tail                                  | Normal            | values written, revision incremented            |
 * | U2   | tail growing past capacity                            | Boundary (max)    | columns grow, old values kept, NaN tail         |
 * | U3   | shorter full / tail shrinking length                  | Boundary          | stale slots NaN                                 |
 * | U4   | tail for unknown id / wrong outputs / from > length   | Abnormal          | ignored (revision still bumps)                  |
 * | U5   | removed payload                                       | Normal            | series deleted                                  |
 * | U6   | empty payload list                                    | Boundary (empty)  | only revision bumps                             |
 * | U7   | indicator with zero outputs                           | Boundary (0)      | series with no columns, length kept             |
 * | A1   | isSeriesAligned: same / other resetVersion / time / empty candles | Equivalence | true / false / false / false          |
 * | X1   | extendRangeWithOutputs widens with finite values      | Normal            | min/max widened                                 |
 * | X2   | NaN values, unknown id, unknown output, unaligned     | Abnormal          | ignored                                         |
 * | X3   | fractional / out-of-range start / end                 | Boundary          | clamped to [ceil(start), floor(end)] ∩ series   |
 */
import { describe, expect, it } from '@jest/globals';
import { createUiCandleSeries } from '../../data/UiCandleSeries';
import type { IndicatorResult } from '../Indicator';
import type { IndicatorUpdate } from '../IndicatorCompute';
import {
  applyIndicatorPayloads,
  emptyUiIndicatorSet,
  extendRangeWithOutputs,
  isSeriesAligned,
  MAX_INDICATOR_PATCH_BARS,
  packIndicatorUpdate,
  UI_INDICATOR_HEADROOM,
} from '../UiIndicatorSet';
import { columnsOf } from './indicatorTestUtils';

function result(
  columns: number[][],
  length = columns[0]?.length ?? 0
): IndicatorResult {
  return {
    outputs: columns.map((c) => {
      const out = new Float64Array(c.length + 10).fill(NaN);
      out.set(c);
      return out;
    }),
    length,
    committed: 0,
    changedFrom: 0,
    state: undefined,
  };
}

function update(
  r: IndicatorResult,
  full: boolean,
  from: number,
  id = 'a'
): IndicatorUpdate {
  return {
    id,
    removed: false,
    full,
    from,
    result: r,
    resetVersion: 1,
    firstTime: 1000,
  };
}

const candles = (n: number, resetVersion = 1) =>
  createUiCandleSeries(
    columnsOf(Array.from({ length: n }, (_, i) => i + 1)),
    0,
    resetVersion
  );

const nums = (a: ArrayLike<number>, n: number) => Array.from(a).slice(0, n);

describe('packIndicatorUpdate', () => {
  it('K1: full payload', () => {
    // Given / When
    const p = packIndicatorUpdate(
      update(
        result([
          [1, 2, 3],
          [4, 5, 6],
        ]),
        true,
        0
      )
    );
    // Then
    expect(p).toMatchObject({
      id: 'a',
      removed: false,
      full: true,
      from: 0,
      length: 3,
      outputs: 2,
    });
    expect(Array.from(p.values)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('K2: tail payload', () => {
    // Given / When
    const p = packIndicatorUpdate(
      update(
        result([
          [1, 2, 3],
          [4, 5, 6],
        ]),
        false,
        2
      )
    );
    // Then
    expect(p).toMatchObject({ full: false, from: 2, length: 3 });
    expect(Array.from(p.values)).toEqual([3, 6]);
  });

  it('K3: 512-bar tail patches, 513 goes full', () => {
    // Given
    const n = MAX_INDICATOR_PATCH_BARS + 1;
    const r = result([Array.from({ length: n }, (_, i) => i)]);
    // When / Then
    expect(packIndicatorUpdate(update(r, false, 1)).full).toBe(false);
    expect(packIndicatorUpdate(update(r, false, 0)).full).toBe(true);
  });

  it('K4: invalid tails go full', () => {
    // Given
    const r = result([[1, 2]]);
    // When / Then
    expect(packIndicatorUpdate(update(r, false, 5)).full).toBe(true);
    expect(packIndicatorUpdate(update(r, false, NaN)).full).toBe(true);
  });

  it('K5: removed payload', () => {
    // Given / When
    const p = packIndicatorUpdate({ id: 'x', removed: true });
    // Then
    expect(p).toMatchObject({ id: 'x', removed: true, length: 0 });
    expect(p.values).toHaveLength(0);
  });
});

describe('applyIndicatorPayloads', () => {
  it('U1: full then tail', () => {
    // Given
    const set = emptyUiIndicatorSet();
    const r = result([[1, 2, 3]]);
    // When
    applyIndicatorPayloads(set, [packIndicatorUpdate(update(r, true, 0))]);
    (r.outputs[0] as Float64Array).set([9, 10], 2);
    r.length = 4;
    applyIndicatorPayloads(set, [packIndicatorUpdate(update(r, false, 2))]);
    // Then
    const s = set.series.a;
    expect(s?.length).toBe(4);
    expect(nums(s?.outputs[0] ?? [], 5)).toEqual([1, 2, 9, 10, NaN]);
    expect(s?.outputs[0]?.length).toBe(3 + UI_INDICATOR_HEADROOM);
    expect(set.revision).toBe(2);
  });

  it('U2: grows past capacity', () => {
    // Given
    const set = emptyUiIndicatorSet();
    applyIndicatorPayloads(set, [
      packIndicatorUpdate(update(result([[1]]), true, 0)),
    ]);
    const cap = set.series.a?.outputs[0]?.length ?? 0;
    const big = result([Array.from({ length: cap + 5 }, (_, i) => i)]);
    // When
    applyIndicatorPayloads(set, [packIndicatorUpdate(update(big, false, 1))]);
    // Then
    const col = set.series.a?.outputs[0] as Float64Array;
    expect(col.length).toBeGreaterThanOrEqual(cap + 5);
    expect(col[0]).toBe(1); // kept from the first snapshot
    expect(col[cap + 4]).toBe(cap + 4);
    expect(Number.isNaN(col[cap + 5] as number)).toBe(true);
  });

  it('U3: shrinking tail clears stale slots', () => {
    // Given
    const set = emptyUiIndicatorSet();
    applyIndicatorPayloads(set, [
      packIndicatorUpdate(update(result([[1, 2, 3, 4]]), true, 0)),
    ]);
    // When
    applyIndicatorPayloads(set, [
      packIndicatorUpdate(update(result([[1, 7]]), false, 1)),
    ]);
    // Then
    expect(set.series.a?.length).toBe(2);
    expect(nums(set.series.a?.outputs[0] ?? [], 4)).toEqual([1, 7, NaN, NaN]);
  });

  it('U4: ignores inapplicable tails', () => {
    // Given
    const set = emptyUiIndicatorSet();
    applyIndicatorPayloads(set, [
      packIndicatorUpdate(update(result([[1, 2]]), true, 0)),
    ]);
    const before = nums(set.series.a?.outputs[0] ?? [], 2);
    // When
    applyIndicatorPayloads(set, [
      packIndicatorUpdate(update(result([[5, 6]]), false, 1, 'unknown')),
      packIndicatorUpdate(
        update(
          result([
            [5, 6],
            [7, 8],
          ]),
          false,
          1
        )
      ),
      { ...packIndicatorUpdate(update(result([[5, 6, 7, 8]]), false, 3)) },
    ]);
    // Then
    expect(set.series.unknown).toBeUndefined();
    expect(nums(set.series.a?.outputs[0] ?? [], 2)).toEqual(before);
    expect(set.revision).toBe(2);
  });

  it('U5 / U6: removal and empty list', () => {
    // Given
    const set = emptyUiIndicatorSet();
    applyIndicatorPayloads(set, [
      packIndicatorUpdate(update(result([[1]]), true, 0)),
    ]);
    // When
    applyIndicatorPayloads(set, [
      packIndicatorUpdate({ id: 'a', removed: true }),
    ]);
    applyIndicatorPayloads(set, []);
    // Then
    expect(set.series).toEqual({});
    expect(set.revision).toBe(3);
  });
});

describe('zero outputs', () => {
  it('U7: series without columns', () => {
    // Given
    const set = emptyUiIndicatorSet();
    const r = result([]);
    r.length = 3;
    // When
    applyIndicatorPayloads(set, [packIndicatorUpdate(update(r, true, 0))]);
    applyIndicatorPayloads(set, [packIndicatorUpdate(update(r, false, 2))]);
    // Then
    expect(set.series.a).toMatchObject({ outputs: [], length: 3 });
  });
});

describe('alignment and autoscale extension', () => {
  const series = (values: number[], resetVersion = 1, firstTime = 1000) => ({
    outputs: [Float64Array.from(values)],
    length: values.length,
    resetVersion,
    firstTime,
  });

  it('A1: isSeriesAligned', () => {
    // Given
    const c = candles(3);
    // When / Then
    expect(isSeriesAligned(series([1]), c)).toBe(true);
    expect(isSeriesAligned(series([1], 2), c)).toBe(false);
    expect(isSeriesAligned(series([1], 1, 2000), c)).toBe(false);
    expect(isSeriesAligned(series([1]), candles(0))).toBe(false);
  });

  it('X1 / X2: widens only with finite aligned values', () => {
    // Given
    const set = {
      series: {
        a: series([5, 50, NaN, -3]),
        stale: series([1000], 9),
      },
      revision: 0,
    };
    const out = { min: 0, max: 10 };
    // When
    extendRangeWithOutputs(
      set,
      candles(4),
      [
        { id: 'a', output: 0 },
        { id: 'a', output: 3 },
        { id: 'missing', output: 0 },
        { id: 'stale', output: 0 },
      ],
      0,
      3,
      out
    );
    // Then
    expect(out).toEqual({ min: -3, max: 50 });
  });

  it('X3: clamps the bar range', () => {
    // Given
    const set = { series: { a: series([100, 1, 2, -100]) }, revision: 0 };
    const refs = [{ id: 'a', output: 0 }];
    const inner = { min: 0, max: 10 };
    const outer = { min: 0, max: 10 };
    // When
    extendRangeWithOutputs(set, candles(4), refs, 0.5, 2.5, inner);
    extendRangeWithOutputs(set, candles(4), refs, -5, 99, outer);
    // Then
    expect(inner).toEqual({ min: 0, max: 10 });
    expect(outer).toEqual({ min: -100, max: 100 });
  });
});
