/**
 * Test perspective table — buildCandleGeometry (metrics: CandleMetrics.test)
 *
 * | Case | Input / Precondition                                   | Perspective         | Expected                                        |
 * |------|--------------------------------------------------------|---------------------|-------------------------------------------------|
 * | G1   | one bullish bar, pr 1                                  | Equivalence         | exact snapped body + wick rects                 |
 * | G2   | close < open                                           | Equivalence         | bearish                                         |
 * | G3   | doji close == open                                     | Boundary            | bullish, 1 px body                              |
 * | G4   | flat bar o = h = l = c                                 | Boundary            | 1 px body and wick                              |
 * | G5   | wick-only metrics                                      | Equivalence         | no bodies, centered wick                        |
 * | G6   | pr 2                                                   | Equivalence         | coordinates on 0.5 dp grid                      |
 * | G7   | range beyond both ends / fractional ends               | Boundary            | clamped / ceil-floor                            |
 * | G8   | empty series / start > end / NaN start / NaN end       | Boundary / invalid  | 0 bars                                          |
 * | G9   | spacing 0 / NaN / ∞                                    | Invalid             | 0 bars                                          |
 * | G10  | max == min / height 0 / NaN top / NaN width / NaN off. | Invalid             | 0 bars                                          |
 * | G11  | NaN / ∞ price in one bar (candle + wick mode)          | Invalid (§33.8)     | that bar skipped, others drawn                  |
 * | G12  | price whose Y overflows to ∞                           | Boundary (huge)     | skipped, never ∞ coords                         |
 * | G12b | open/close Y overflows while high/low stay finite  | Invalid (corrupt)   | skipped in candle mode                          |
 * | G13  | columns with offset                                    | Equivalence         | reads from offset                               |
 * | G14  | 2000 random bars × random zoom / pr                    | Invariant           | finite, snapped, wick centered, counts add up   |
 */
import { describe, expect, it } from '@jest/globals';
import { createSeededRandom } from '../../../testing/fixtures/random';
import type { PriceScaleSnapshot } from '../../../viewport/PriceScale';
import type { TimeScaleState } from '../../../viewport/TimeScale';
import {
  buildCandleGeometry,
  computeCandleMetrics,
  createCandleMetrics,
  type CandleGeometrySink,
  type CandleMetrics,
  type CandleSeriesView,
} from '../CandleGeometry';

interface Emitted {
  kind: 'body' | 'wick';
  bullish: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

function recorder(): { sink: CandleGeometrySink; out: Emitted[] } {
  const out: Emitted[] = [];
  return {
    out,
    sink: {
      body: (bullish, x, y, w, h) =>
        out.push({ kind: 'body', bullish, x, y, w, h }),
      wick: (bullish, x, y, w, h) =>
        out.push({ kind: 'wick', bullish, x, y, w, h }),
    },
  };
}

type Bar = [open: number, high: number, low: number, close: number];

function series(bars: Bar[], offset = 0): CandleSeriesView {
  const n = bars.length + offset;
  const cols = [0, 1, 2, 3].map(() => new Float64Array(n).fill(NaN));
  bars.forEach((bar, i) => bar.forEach((v, c) => (cols[c]![offset + i] = v)));
  return {
    open: cols[0]!,
    high: cols[1]!,
    low: cols[2]!,
    close: cols[3]!,
    offset,
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

/** width 100, spacing 10, last bar centered at x = 95. */
function time(barCount: number, patch: Partial<TimeScaleState> = {}) {
  return { width: 100, barSpacing: 10, rightOffset: 0, barCount, ...patch };
}

function metrics(spacing = 10, pr = 1, ratio = 0.8, wick = 1): CandleMetrics {
  return computeCandleMetrics(spacing, ratio, wick, pr, createCandleMetrics());
}

function build(
  s: CandleSeriesView,
  start = 0,
  end = s.length - 1,
  t: TimeScaleState = time(s.length),
  p: PriceScaleSnapshot = price,
  m: CandleMetrics = metrics()
) {
  const r = recorder();
  const count = buildCandleGeometry(s, start, end, t, p, m, r.sink);
  return { count, out: r.out };
}

describe('buildCandleGeometry', () => {
  it('G1: emits exact pixel-snapped rects for a bullish bar', () => {
    // Given: x = 95, body 7 px (8 → parity), y(p) = 100 - p
    const s = series([[20, 80, 10, 60]]);
    // When
    const { count, out } = build(s);
    // Then
    expect(count).toBe(1);
    expect(out).toEqual([
      { kind: 'body', bullish: true, x: 92, y: 40, w: 7, h: 40 },
      { kind: 'wick', bullish: true, x: 95, y: 20, w: 1, h: 70 },
    ]);
  });

  it('G2: classifies close < open as bearish', () => {
    // Given / When
    const { out } = build(series([[60, 80, 10, 20]]));
    // Then
    expect(out.map((e) => e.bullish)).toEqual([false, false]);
    expect(out[0]).toMatchObject({ y: 40, h: 40 });
  });

  it('G3: draws a doji as bullish with a 1 px body', () => {
    // Given / When
    const { out } = build(series([[50, 70, 30, 50]]));
    // Then
    expect(out[0]).toMatchObject({ kind: 'body', bullish: true, y: 50, h: 1 });
  });

  it('G4: gives a flat bar 1 px body and wick', () => {
    // Given / When
    const { out } = build(series([[50, 50, 50, 50]]));
    // Then
    expect(out.map((e) => e.h)).toEqual([1, 1]);
  });

  it('G5: draws only centered wicks in wick-only mode', () => {
    // Given
    const s = series([
      [20, 80, 10, 60],
      [60, 70, 40, 50],
    ]);
    const m = metrics(2, 1, 0.8, 1);
    // When
    const { count, out } = build(s, 0, 1, time(2, { barSpacing: 2 }), price, m);
    // Then: centers at 97 and 99 → left = round(c - 0.5)
    expect(count).toBe(2);
    expect(out.every((e) => e.kind === 'wick')).toBe(true);
    expect(out.map((e) => [e.x, e.bullish])).toEqual([
      [97, true],
      [99, false],
    ]);
  });

  it('G6: snaps to half-dp at pixel ratio 2', () => {
    // Given
    const s = series([[20.3, 80.1, 10.7, 60.2]]);
    // When
    const { out } = build(s, 0, 0, time(1), price, metrics(10, 2));
    // Then
    for (const e of out) {
      for (const v of [e.x, e.y, e.w, e.h]) {
        expect(Number.isInteger(v * 2)).toBe(true);
      }
    }
  });

  it('G7: clamps the range to the series and rounds fractional ends inward', () => {
    // Given
    const s = series([
      [1, 2, 0, 1],
      [1, 2, 0, 1],
      [1, 2, 0, 1],
    ]);
    // When / Then
    expect(build(s, -5, 100).count).toBe(3);
    expect(build(s, 0.2, 1.8).count).toBe(1);
  });

  it.each([
    ['empty series', series([]), 0, 0],
    ['start > end', series([[1, 2, 0, 1]]), 1, 0],
    ['NaN start', series([[1, 2, 0, 1]]), NaN, 0],
    ['NaN end', series([[1, 2, 0, 1]]), 0, NaN],
  ])('G8: %s → nothing', (_label, s, start, end) => {
    // Given / When
    const { count, out } = build(s, start, end);
    // Then
    expect(count).toBe(0);
    expect(out).toHaveLength(0);
  });

  it.each([0, NaN, Infinity])('G9: bar spacing %p → nothing', (spacing) => {
    // Given / When / Then
    expect(
      build(series([[1, 2, 0, 1]]), 0, 0, time(1, { barSpacing: spacing }))
        .count
    ).toBe(0);
  });

  it.each([
    ['max == min', { ...price, min: 5, max: 5 }, time(1)],
    ['height 0', { ...price, height: 0 }, time(1)],
    ['NaN top', { ...price, top: NaN }, time(1)],
    ['NaN width', price, time(1, { width: NaN })],
    ['NaN rightOffset', price, time(1, { rightOffset: NaN })],
  ])('G10: degenerate scale (%s) → nothing', (_label, p, t) => {
    // Given / When / Then
    expect(build(series([[1, 2, 0, 1]]), 0, 0, t, p).count).toBe(0);
  });

  it.each([
    ['NaN open', [NaN, 80, 10, 60]],
    ['NaN close', [20, 80, 10, NaN]],
    ['Infinity high', [20, Infinity, 10, 60]],
    ['-Infinity low', [20, 80, -Infinity, 60]],
  ] as [string, Bar][])(
    'G11: skips a bar with %s (both modes)',
    (_label, bad) => {
      // Given
      const s = series([[20, 80, 10, 60], bad, [20, 80, 10, 60]]);
      // When
      const candles = build(s);
      const wicks = build(s, 0, 2, time(3), price, metrics(1));
      // Then
      expect(candles.count).toBe(2);
      expect(wicks.count).toBe(2);
      for (const e of [...candles.out, ...wicks.out]) {
        expect(Number.isFinite(e.x + e.y + e.w + e.h)).toBe(true);
      }
    }
  );

  it('G12: skips bars whose Y overflows instead of emitting ∞', () => {
    // Given: a tiny price range and a huge price
    const p = { ...price, min: 0, max: 1e-300, height: 1000 };
    const s = series([[1e300, 1e300, 0, 1e300]]);
    // When
    const { count, out } = build(s, 0, 0, time(1), p);
    // Then
    expect(count).toBe(0);
    expect(out).toHaveLength(0);
  });

  it('G12b: skips a body whose open/close Y overflows', () => {
    // Given: unvalidated bar with open far outside [low, high]
    const p = { ...price, min: 0, max: 1e-300, height: 1000 };
    const s = series([[1e300, 10, 0, 5]]);
    // When
    const { count } = build(s, 0, 0, time(1), p);
    // Then
    expect(count).toBe(0);
  });

  it('G13: reads bars starting at the column offset', () => {
    // Given
    const s = series([[20, 80, 10, 60]], 3);
    // When
    const { out } = build(s);
    // Then
    expect(out[1]).toMatchObject({ y: 20, h: 70 });
  });

  it('G14: random bars stay finite, snapped, centered and complete', () => {
    // Given
    const rnd = createSeededRandom(7);
    const bars: Bar[] = [];
    let last = 100;
    for (let i = 0; i < 2000; i++) {
      const o = last;
      const c = o + (rnd() - 0.5) * 4;
      bars.push([o, Math.max(o, c) + rnd() * 2, Math.min(o, c) - rnd() * 2, c]);
      last = c;
    }
    const s = series(bars);
    const p = { ...price, min: 50, max: 150, height: 400 };
    for (let run = 0; run < 20; run++) {
      const pr = [1, 1.5, 2, 2.625, 3][run % 5]!;
      const spacing = 0.5 + rnd() * 40;
      const t = time(2000, {
        width: 360,
        barSpacing: spacing,
        rightOffset: -rnd() * 1500,
      });
      const m = metrics(spacing, pr, 0.8, 1);
      // When
      const { count, out } = build(s, 0, 1999, t, p, m);
      // Then
      const bodies = out.filter((e) => e.kind === 'body');
      const wicks = out.filter((e) => e.kind === 'wick');
      expect(count).toBe(2000);
      expect(wicks).toHaveLength(2000);
      expect(bodies).toHaveLength(m.wickOnly ? 0 : 2000);
      const bad = out.filter(
        (e) =>
          !(e.w > 0 && e.h > 0) ||
          [e.x, e.y, e.w, e.h].some(
            (v) => Math.abs(v * pr - Math.round(v * pr)) > 1e-6
          )
      );
      expect(bad).toEqual([]);
      if (!m.wickOnly) {
        for (let i = 0; i < 2000; i += 97) {
          const b = bodies[i]!;
          const w = wicks[i]!;
          expect(b.x + b.w / 2).toBeCloseTo(w.x + w.w / 2, 9);
          expect(b.bullish).toBe(w.bullish);
        }
      }
    }
  });
});
