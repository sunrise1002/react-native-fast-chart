/**
 * Test perspective table — histogram geometry
 *
 * Scales: x(i) = 10·i, y(v) = 50 − v (pane 0 … 100, baseline y 50),
 * bar width 6 dp, pixel ratio 1 unless stated.
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                    |
 * |------|--------------------------------------------------------|----------------------|---------------------------------------------|
 * | B1   | sign: positive / negative values                       | Normal               | bucket 0 / 1                                |
 * | B2   | trend: ≥0 rising / ≥0 falling / <0 falling / <0 rising | Equivalence          | 0 / 1 / 2 / 3                               |
 * | B3   | trend: first bar, NaN previous, equal previous          | Boundary             | not rising                                  |
 * | B4   | candle: bull / bear / doji / NaN candle / no candles    | Equivalence / NULL   | 0 / 1 / 0 / 1 / 0                           |
 * | B5   | bucket counts                                          | Normal               | trend 4, sign 2, candle 2                   |
 * | G1   | positive and negative bars                             | Normal               | rects above / below the baseline            |
 * | G2   | zero / NaN / ±∞ values                                 | Abnormal             | skipped                                     |
 * | G3   | tiny value (< 1 px)                                    | Boundary             | 1 px tall bar on the value side             |
 * | G4   | value beyond the pane                                  | Boundary (max)       | clamped 1 px beyond the pane                |
 * | G5   | baseline outside the pane (volume 10 … 20 scale)       | Boundary             | bars grow from the pane bottom (+1)         |
 * | G6   | fractional / out-of-range start–end, length < values    | Boundary             | clamped slice                               |
 * | G7   | NaN start / NaN end / degenerate scale / empty         | Invalid / empty      | 0                                           |
 * | G8   | pixel ratio 2, fractional centers                      | Boundary             | edges on device pixels                      |
 * | G9   | candle mode with offset                                | Normal               | buckets from `offset + i`                   |
 */
import { describe, expect, it } from '@jest/globals';
import type { PriceScaleSnapshot } from '../../../viewport/PriceScale';
import type { TimeScaleState } from '../../../viewport/TimeScale';
import type {
  CandleMetrics,
  CandleSeriesView,
} from '../../candles/CandleGeometry';
import {
  buildHistogramGeometry,
  histogramBucket,
  histogramBucketCount,
} from '../HistogramGeometry';
import type { HistogramColorMode } from '../../../indicators/Indicator';

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
  min: -50,
  max: 50,
};
const METRICS: CandleMetrics = {
  wickOnly: false,
  bodyWidthPx: 6,
  wickWidthPx: 1,
  pixelRatio: 1,
};

function candles(
  open: number[],
  close: number[],
  offset = 0
): CandleSeriesView {
  return {
    open,
    close,
    high: close,
    low: open,
    offset,
    length: open.length - offset,
  };
}

type Bar = [number, number, number, number, number];

function build(
  values: number[],
  options: {
    start?: number;
    end?: number;
    length?: number;
    price?: PriceScaleSnapshot;
    time?: TimeScaleState;
    metrics?: CandleMetrics;
    mode?: HistogramColorMode;
    candles?: CandleSeriesView | null;
  } = {}
) {
  const bars: Bar[] = [];
  const count = buildHistogramGeometry(
    values,
    options.length ?? values.length,
    options.start ?? 0,
    options.end ?? 9,
    options.time ?? TIME,
    options.price ?? PRICE,
    options.metrics ?? METRICS,
    options.mode ?? 'sign',
    options.candles ?? null,
    { bar: (b, x, y, w, h) => bars.push([b, x, y, w, h]) }
  );
  return { count, bars };
}

describe('histogramBucket', () => {
  it('B1: sign', () => {
    // Given / When / Then
    expect(histogramBucket('sign', [3, -3], 0, null)).toBe(0);
    expect(histogramBucket('sign', [3, -3], 1, null)).toBe(1);
    expect(histogramBucket('sign', [0], 0, null)).toBe(0);
  });

  it('B2: trend buckets', () => {
    // Given
    const v = [1, 2, 1, -1, -2, -1];
    // When / Then
    expect(histogramBucket('trend', v, 1, null)).toBe(0);
    expect(histogramBucket('trend', v, 2, null)).toBe(1);
    expect(histogramBucket('trend', v, 4, null)).toBe(2);
    expect(histogramBucket('trend', v, 5, null)).toBe(3);
  });

  it('B3: trend without a rising previous value', () => {
    // Given / When / Then
    expect(histogramBucket('trend', [5], 0, null)).toBe(1);
    expect(histogramBucket('trend', [-5], 0, null)).toBe(2);
    expect(histogramBucket('trend', [NaN, 5], 1, null)).toBe(1);
    expect(histogramBucket('trend', [5, 5], 1, null)).toBe(1);
    expect(histogramBucket('trend', [-5, -5], 1, null)).toBe(2);
  });

  it('B4: candle direction', () => {
    // Given
    const c = candles([1, 2, 3, NaN], [2, 1, 3, 4]);
    // When / Then
    expect(histogramBucket('candle', [1, 1, 1, 1], 0, c)).toBe(0);
    expect(histogramBucket('candle', [1, 1, 1, 1], 1, c)).toBe(1);
    expect(histogramBucket('candle', [1, 1, 1, 1], 2, c)).toBe(0);
    expect(histogramBucket('candle', [1, 1, 1, 1], 3, c)).toBe(1);
    expect(histogramBucket('candle', [1], 0, null)).toBe(0);
  });

  it('B5: bucket counts', () => {
    // Given / When / Then
    expect(histogramBucketCount('trend')).toBe(4);
    expect(histogramBucketCount('sign')).toBe(2);
    expect(histogramBucketCount('candle')).toBe(2);
  });
});

describe('buildHistogramGeometry', () => {
  it('G1: bars from the baseline', () => {
    // Given / When
    const { count, bars } = build([20, -10]);
    // Then
    expect(count).toBe(2);
    expect(bars).toEqual([
      [0, -3, 30, 6, 20],
      [1, 7, 50, 6, 10],
    ]);
  });

  it('G2: zero and non-finite values are skipped', () => {
    // Given / When
    const { count, bars } = build([0, NaN, Infinity, -Infinity, 5]);
    // Then
    expect(count).toBe(1);
    expect(bars[0]?.[1]).toBe(37);
  });

  it('G3: sub-pixel values keep one pixel', () => {
    // Given / When
    const { bars } = build([0.2, -0.2]);
    // Then
    expect(bars).toEqual([
      [0, -3, 49, 6, 1],
      [1, 7, 50, 6, 1],
    ]);
  });

  it('G4: values beyond the pane are clamped', () => {
    // Given / When
    const { bars } = build([1e300, -1e300]);
    // Then
    expect(bars).toEqual([
      [0, -3, -1, 6, 51],
      [1, 7, 50, 6, 51],
    ]);
  });

  it('G5: baseline below the pane', () => {
    // Given: scale 10 … 20, 0 lies far below
    const price = { ...PRICE, min: 10, max: 20 };
    // When
    const { bars } = build([15], { price });
    // Then: from y 50 down to the clamped baseline 101
    expect(bars).toEqual([[0, -3, 50, 6, 51]]);
  });

  it('G6: slice clamping', () => {
    // Given
    const values = [1, 2, 3, 4, 5, 6];
    // When
    const mid = build(values, { start: 1.2, end: 3.7 });
    const wide = build(values, { start: -5, end: 99, length: 4 });
    // Then
    expect(mid.bars.map((b) => b[1])).toEqual([17, 27]);
    expect(wide.count).toBe(4);
  });

  it.each([
    ['NaN start', { start: NaN }],
    ['NaN end', { end: NaN }],
    ['degenerate price', { price: { ...PRICE, min: 5, max: 5 } }],
    ['NaN top', { price: { ...PRICE, top: NaN } }],
    ['empty', { length: 0 }],
    ['end < start', { start: 5, end: 2 }],
  ])('G7: %s → nothing', (_name, options) => {
    // Given / When
    const { count, bars } = build([1, 2, 3, 4, 5, 6], options);
    // Then
    expect(count).toBe(0);
    expect(bars).toEqual([]);
  });

  it('G7b: NaN bar positions are skipped', () => {
    // Given
    const time = { ...TIME, barSpacing: NaN };
    // When / Then
    expect(build([1, 2], { time }).count).toBe(0);
  });

  it('G8: device-pixel alignment', () => {
    // Given: pr 2, centers at 10·i + 2.3
    const time = { ...TIME, width: 102.3 };
    const metrics = { ...METRICS, bodyWidthPx: 9, pixelRatio: 2 };
    // When
    const { bars } = build([10.3], { time, metrics });
    // Then
    const [, x, y, w, h] = bars[0] as Bar;
    expect([x * 2, y * 2, w * 2, (y + h) * 2].every(Number.isInteger)).toBe(
      true
    );
    expect(w).toBe(4.5);
  });

  it('G9: candle buckets honor the offset', () => {
    // Given: bar 0 ↔ candle 1 (bearish), bar 1 ↔ candle 2 (bullish)
    const c = candles([0, 5, 1], [0, 4, 2], 1);
    // When
    const { bars } = build([3, 3], { mode: 'candle', candles: c });
    // Then
    expect(bars.map((b) => b[0])).toEqual([1, 0]);
  });
});
