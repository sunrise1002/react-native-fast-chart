/**
 * Test perspective table — Conflation (candles, group sizing, time scale)
 *
 * | Case  | Input / Precondition                                      | Perspective        | Expected                                    |
 * |-------|-----------------------------------------------------------|--------------------|---------------------------------------------|
 * | CF01  | conflationMinSlotPx: 2 px / wick wider / 0 / NaN / ∞      | Equivalence / inv. | max(bucket, wick px) / 0 / 0 / wick         |
 * | CF02  | group size: wide bars, 1 px slot, 0.01 dp, 1e-12 dp       | Equivalence / max  | 1 / 2 / 256 / 2^30                          |
 * | CF03  | group size: NaN / 0 / ∞ spacing, minSlot 0, pr NaN        | Invalid            | 1 (pr NaN → 1)                              |
 * | CF04  | groupLevel 1 / 2 / 8 / 0 / NaN / 2^40                     | Boundary           | 0 / 1 / 3 / 0 / 0 / 30                      |
 * | CF05  | conflatedTimeScale                                        | Equivalence (prop.)| bucket x = group center x; spacing × g      |
 * | CF06  | conflateCandles random, g 2 / 8 / 64, unaligned start     | Equivalence (prop.)| OHLC = brute force (partial last group)     |
 * | CF07  | group with only NaN high/low                              | Invalid            | NaN OHLC                                    |
 * | CF08  | start > end, NaN start, empty series, group 0             | Boundary (empty)   | 0 buckets                                   |
 * | CF09  | group wider than the data; single-bar series              | Boundary (max)     | 1 bucket = whole series                     |
 * | CF10  | group 1 (level 0), NaN bar                                | Boundary (min)     | identity; NaN bar → NaN                     |
 * | CF11  | output capacity 0 grows; smaller reuse keeps buffers      | Boundary           | grown ×2 / same arrays                      |
 */
import { describe, expect, it } from '@jest/globals';
import { createMinMaxPyramid, syncPyramid } from '../../../data/MinMaxPyramid';
import { indexToX, type TimeScaleState } from '../../../viewport/TimeScale';
import {
  conflateCandles,
  conflatedTimeScale,
  conflationGroupSize,
  conflationMinSlotPx,
  createConflatedCandles,
  groupLevel,
} from '../Conflation';
import { createSeededRandom } from '../../../testing/fixtures/random';

function candles(seed: number, n: number) {
  const next = createSeededRandom(seed);
  const s = {
    open: new Float64Array(n),
    high: new Float64Array(n),
    low: new Float64Array(n),
    close: new Float64Array(n),
    offset: 0,
    length: n,
  };
  for (let i = 0; i < n; i++) {
    s.open[i] = 100 + next() * 10;
    s.close[i] = 100 + next() * 10;
    s.high[i] = Math.max(s.open[i] as number, s.close[i] as number) + next();
    s.low[i] = Math.min(s.open[i] as number, s.close[i] as number) - next();
  }
  return s;
}

type Series = ReturnType<typeof candles>;

function pyramidOf(s: Series) {
  const p = createMinMaxPyramid();
  syncPyramid(p, s.low, s.high, 0, s.length, 0);
  return p;
}

const time: TimeScaleState = {
  width: 400,
  barSpacing: 0.25,
  rightOffset: 3.3,
  barCount: 1000,
};

function run(s: Series, start: number, end: number, group: number) {
  const out = createConflatedCandles();
  const count = conflateCandles(s, pyramidOf(s), start, end, time, group, out, {
    min: NaN,
    max: NaN,
  });
  return { out, count };
}

describe('conflationMinSlotPx', () => {
  it('CF01: combines the bucket width and the wick width', () => {
    // Given / When / Then
    expect(conflationMinSlotPx(2, 1, 1)).toBe(2);
    expect(conflationMinSlotPx(2, 1, 3)).toBe(3);
    expect(conflationMinSlotPx(0, 1, 3)).toBe(0);
    expect(conflationMinSlotPx(NaN, 1, 3)).toBe(0);
    expect(conflationMinSlotPx(-1, 1, 3)).toBe(0);
    expect(conflationMinSlotPx(Infinity, 1, 2)).toBe(2);
  });
});

describe('conflationGroupSize', () => {
  it('CF02: picks the smallest power of two reaching the slot', () => {
    // Given / When / Then
    expect(conflationGroupSize(8, 2, 2)).toBe(1);
    expect(conflationGroupSize(1, 2, 2)).toBe(1);
    expect(conflationGroupSize(0.5, 2, 2)).toBe(2);
    expect(conflationGroupSize(0.01, 1, 2)).toBe(256);
    expect(conflationGroupSize(1e-12, 1, 2)).toBe(2 ** 30);
  });

  it('CF03: returns 1 for invalid input', () => {
    // Given / When / Then
    expect(conflationGroupSize(NaN, 1, 2)).toBe(1);
    expect(conflationGroupSize(0, 1, 2)).toBe(1);
    expect(conflationGroupSize(Infinity, 1, 2)).toBe(1);
    expect(conflationGroupSize(0.1, 1, 0)).toBe(1);
    expect(conflationGroupSize(0.1, 1, NaN)).toBe(1);
    expect(conflationGroupSize(0.5, NaN, 2)).toBe(4);
  });
});

describe('groupLevel', () => {
  it('CF04: is log2 of the group', () => {
    // Given / When / Then
    expect([1, 2, 8, 0, NaN, 2 ** 40].map(groupLevel)).toEqual([
      0, 1, 3, 0, 0, 30,
    ]);
  });
});

describe('conflatedTimeScale', () => {
  it('CF05: centers each bucket on its group', () => {
    // Given
    const out: TimeScaleState = {
      width: 0,
      barSpacing: 0,
      rightOffset: 0,
      barCount: 0,
    };
    for (const group of [2, 8, 64]) {
      for (const firstGroup of [0, 3, 11]) {
        // When
        conflatedTimeScale(time, group, firstGroup, 5, out);
        // Then
        expect(out.barSpacing).toBe(time.barSpacing * group);
        expect(out.barCount).toBe(5);
        expect(out.width).toBe(time.width);
        for (let b = 0; b < 5; b++) {
          const center = (firstGroup + b) * group + (group - 1) / 2;
          expect(indexToX(out, b)).toBeCloseTo(indexToX(time, center), 9);
        }
      }
    }
  });
});

describe('conflateCandles', () => {
  it('CF06: buckets match brute-force OHLC', () => {
    // Given
    const s = candles(1, 1000);
    for (const group of [2, 8, 64]) {
      // When: unaligned start, end at the last bar
      const { out, count } = run(s, 13.4, 999, group);
      // Then
      const first = Math.floor(14 / group);
      expect(out.firstGroup).toBe(first);
      expect(count).toBe(Math.floor(999 / group) - first + 1);
      expect(out.length).toBe(count);
      for (let b = 0; b < count; b++) {
        const from = (first + b) * group;
        const to = Math.min(from + group, 1000) - 1;
        const hi = Math.max(...s.high.subarray(from, to + 1));
        const lo = Math.min(...s.low.subarray(from, to + 1));
        expect([out.open[b], out.high[b], out.low[b], out.close[b]]).toEqual([
          s.open[from],
          hi,
          lo,
          s.close[to],
        ]);
      }
    }
  });

  it('CF07: gives NaN prices to groups without finite values', () => {
    // Given: bars 4..7 have NaN high/low
    const s = candles(2, 16);
    s.high.fill(NaN, 4, 8);
    s.low.fill(NaN, 4, 8);
    // When
    const { out } = run(s, 0, 15, 4);
    // Then
    expect([out.open[1], out.high[1], out.low[1], out.close[1]]).toEqual([
      NaN,
      NaN,
      NaN,
      NaN,
    ]);
    expect(Number.isFinite(out.high[2])).toBe(true);
  });

  it('CF08: returns 0 buckets for empty or invalid ranges', () => {
    // Given
    const s = candles(3, 16);
    // When / Then
    expect(run(s, 9, 3, 4).count).toBe(0);
    expect(run(s, NaN, 3, 4).count).toBe(0);
    expect(run(s, 0, 15, 0).count).toBe(0);
    expect(run(candles(3, 0), 0, 15, 4).count).toBe(0);
    const { out } = run(s, 9, 3, 4);
    expect([out.length, out.firstGroup]).toEqual([0, 0]);
  });

  it('CF09: a group wider than the data is the whole series', () => {
    // Given
    const s = candles(4, 10);
    const single = candles(5, 1);
    // When
    const wide = run(s, 0, 9, 64);
    const one = run(single, 0, 0, 4);
    // Then
    expect(wide.count).toBe(1);
    expect(wide.out.high[0]).toBe(Math.max(...s.high));
    expect(wide.out.low[0]).toBe(Math.min(...s.low));
    expect(wide.out.close[0]).toBe(s.close[9]);
    expect(one.count).toBe(1);
    expect(one.out.high[0]).toBe(single.high[0]);
  });

  it('CF10: group 1 is the identity; NaN bars become NaN', () => {
    // Given
    const s = candles(6, 8);
    s.low[3] = NaN;
    s.high[3] = NaN;
    s.low[5] = -Infinity;
    // When
    const { out, count } = run(s, 0, 7, 1);
    // Then
    expect(count).toBe(8);
    expect(out.high[0]).toBe(s.high[0]);
    expect(out.low[0]).toBe(s.low[0]);
    expect(out.open[3]).toBeNaN();
    expect(out.open[5]).toBeNaN();
  });

  it('CF11: grows the output buffers and reuses them', () => {
    // Given: an empty output
    const s = candles(7, 100);
    const pyramid = pyramidOf(s);
    const out = createConflatedCandles(3);
    const scratch = { min: NaN, max: NaN };
    // When
    conflateCandles(s, pyramid, 0, 99, time, 2, out, scratch);
    const grown = out.open;
    conflateCandles(s, pyramid, 0, 99, time, 4, out, scratch);
    // Then
    expect(grown.length).toBe(50);
    expect(out.open).toBe(grown);
    expect(out.length).toBe(25);
    expect(createConflatedCandles(NaN).open.length).toBe(0);
    const doubled = createConflatedCandles(30);
    conflateCandles(s, pyramid, 0, 99, time, 2, doubled, scratch);
    expect(doubled.open.length).toBe(60);
  });
});
