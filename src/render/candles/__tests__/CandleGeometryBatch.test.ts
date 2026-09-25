/**
 * Test perspective table — CandleGeometryBatch
 *
 * | Case | Input / Precondition                        | Perspective        | Expected                                  |
 * |------|---------------------------------------------|--------------------|-------------------------------------------|
 * | B1   | createCandleGeometryBatch() / (8)           | Equivalence / 0    | empty lists (0 / 32 floats)               |
 * | B2   | 1 bull + 1 bear bar                         | Equivalence        | rects routed to the right lists           |
 * | B3   | wick-only metrics                           | Equivalence        | mode 'wicks', no bodies                   |
 * | B4   | refill after a larger fill                  | Equivalence        | counts reset, storage reused              |
 * | B5   | one NaN bar among 3                         | Invalid            | skipped = 1                               |
 * | B5b  | range [0.5, 50] over 2 bars                 | Boundary           | only bar 1, skipped 0                     |
 * | B6   | empty series / start > end / NaN bounds     | Boundary / invalid | all counts 0, skipped 0                   |
 * | B7   | degenerate price scale                      | Invalid            | nothing emitted, skipped = requested      |
 * | B8   | custom sink                                 | Equivalence        | sink used, batch lists stay empty         |
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { PriceScaleSnapshot } from '../../../viewport/PriceScale';
import {
  computeCandleMetrics,
  createCandleMetrics,
  type CandleGeometrySink,
  type CandleSeriesView,
} from '../CandleGeometry';
import {
  createCandleGeometryBatch,
  fillCandleGeometryBatch,
} from '../CandleGeometryBatch';

function series(bars: number[][]): CandleSeriesView {
  const col = (c: number) => Float64Array.from(bars, (b) => b[c]!);
  return {
    open: col(0),
    high: col(1),
    low: col(2),
    close: col(3),
    offset: 0,
    length: bars.length,
  };
}

const price: PriceScaleSnapshot = {
  mode: 'linear',
  top: 0,
  height: 100,
  min: 0,
  max: 100,
};
const time = (n: number) => ({
  width: 100,
  barSpacing: 10,
  rightOffset: 0,
  barCount: n,
});
const metrics = (spacing = 10) =>
  computeCandleMetrics(spacing, 0.8, 1, 1, createCandleMetrics());

const BULL = [20, 80, 10, 60];
const BEAR = [60, 80, 10, 20];

describe('CandleGeometryBatch', () => {
  it('B1: creates empty lists with optional capacity', () => {
    // Given / When
    const empty = createCandleGeometryBatch();
    const sized = createCandleGeometryBatch(8);
    // Then
    expect(empty).toMatchObject({ mode: 'candles', skipped: 0 });
    expect(empty.bullBodies.data).toHaveLength(0);
    expect(sized.bearWicks.data).toHaveLength(32);
    expect(sized.bearWicks.count).toBe(0);
  });

  it('B2: routes bodies and wicks by direction', () => {
    // Given
    const batch = createCandleGeometryBatch();
    // When
    fillCandleGeometryBatch(
      batch,
      series([BULL, BEAR]),
      0,
      1,
      time(2),
      price,
      metrics()
    );
    // Then
    expect(batch.mode).toBe('candles');
    expect(
      [
        batch.bullBodies,
        batch.bearBodies,
        batch.bullWicks,
        batch.bearWicks,
      ].map((l) => l.count)
    ).toEqual([1, 1, 1, 1]);
    expect(Array.from(batch.bullBodies.data.subarray(0, 4))).toEqual([
      82, 40, 7, 40,
    ]);
    expect(batch.skipped).toBe(0);
  });

  it('B3: switches to wick mode for narrow bars', () => {
    // Given
    const batch = createCandleGeometryBatch();
    const t = { ...time(2), barSpacing: 1 };
    // When
    fillCandleGeometryBatch(
      batch,
      series([BULL, BEAR]),
      0,
      1,
      t,
      price,
      metrics(1)
    );
    // Then
    expect(batch.mode).toBe('wicks');
    expect(batch.bullBodies.count + batch.bearBodies.count).toBe(0);
    expect(batch.bullWicks.count + batch.bearWicks.count).toBe(2);
  });

  it('B4: resets counts and reuses storage on refill', () => {
    // Given
    const batch = createCandleGeometryBatch();
    const big = series(Array.from({ length: 20 }, () => BULL));
    fillCandleGeometryBatch(
      batch,
      big,
      0,
      19,
      { ...time(20), width: 200 },
      price,
      metrics()
    );
    const storage = batch.bullBodies.data;
    // When
    fillCandleGeometryBatch(
      batch,
      series([BULL]),
      0,
      0,
      time(1),
      price,
      metrics()
    );
    // Then
    expect(batch.bullBodies.count).toBe(1);
    expect(batch.bullBodies.data).toBe(storage);
  });

  it('B5: counts bars skipped for invalid prices', () => {
    // Given
    const batch = createCandleGeometryBatch();
    // When
    fillCandleGeometryBatch(
      batch,
      series([BULL, [NaN, 1, 1, 1], BEAR]),
      0,
      2,
      time(3),
      price,
      metrics()
    );
    // Then
    expect(batch.skipped).toBe(1);
    expect(batch.bullWicks.count + batch.bearWicks.count).toBe(2);
  });

  it('B5b: clamps the range and rounds a fractional start up', () => {
    // Given
    const batch = createCandleGeometryBatch();
    // When
    fillCandleGeometryBatch(
      batch,
      series([BULL, BEAR]),
      0.5,
      50,
      time(2),
      price,
      metrics()
    );
    // Then
    expect(batch.skipped).toBe(0);
    expect(batch.bearWicks.count).toBe(1);
    expect(batch.bullWicks.count).toBe(0);
  });

  it.each([
    ['empty series', [], 0, 0],
    ['start > end', [BULL], 1, 0],
    ['NaN start', [BULL], NaN, 0],
    ['NaN end', [BULL], 0, NaN],
  ])('B6: %s → empty batch', (_label, bars, start, end) => {
    // Given
    const batch = createCandleGeometryBatch();
    // When
    fillCandleGeometryBatch(
      batch,
      series(bars),
      start,
      end,
      time(bars.length),
      price,
      metrics()
    );
    // Then
    expect(batch.skipped).toBe(0);
    expect(batch.bullWicks.count + batch.bearWicks.count).toBe(0);
  });

  it('B7: reports every bar as skipped on a degenerate scale', () => {
    // Given
    const batch = createCandleGeometryBatch();
    // When
    fillCandleGeometryBatch(
      batch,
      series([BULL, BEAR]),
      0,
      1,
      time(2),
      { ...price, max: 0 },
      metrics()
    );
    // Then
    expect(batch.skipped).toBe(2);
  });

  it('B8: streams into a custom sink when given', () => {
    // Given
    const batch = createCandleGeometryBatch();
    const sink: CandleGeometrySink = { body: jest.fn(), wick: jest.fn() };
    // When
    fillCandleGeometryBatch(
      batch,
      series([BULL]),
      0,
      0,
      time(1),
      price,
      metrics(),
      sink
    );
    // Then
    expect(sink.body).toHaveBeenCalledWith(true, 92, 40, 7, 40);
    expect(sink.wick).toHaveBeenCalledTimes(1);
    expect(batch.bullBodies.count).toBe(0);
  });
});
