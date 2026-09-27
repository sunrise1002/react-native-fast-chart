/**
 * Test perspective table — anchored VWAP
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                     |
 * |------|--------------------------------------------------------|----------------------|----------------------------------------------|
 * | W1   | 2 bars x 10 / 20, volume 1 / 3, band 1                 | Golden (hand)        | 10, 17.5; σ = √18.75                         |
 * | W2   | generated 15m bars, session / week / month (UTC)       | Golden (reference)   | equals naive per-period sums                 |
 * | W3   | bars around 05:00Z, UTC vs America/New_York            | Equivalence (zone)   | reset at NY midnight only in the NY zone     |
 * | W4   | fixed offset zone (+540 minutes)                       | Equivalence          | reset at 15:00Z                              |
 * | W5   | bands 0 (off) / 2 / 3                                  | Boundary (0)         | NaN when off, k·σ when on                    |
 * | W6   | NaN time / price / ∞ volume mid-period                 | Abnormal             | NaN at bar, period sums untouched            |
 * | W7   | zero volume at the period start                        | Boundary (0)         | NaN until volume arrives                     |
 * | W8   | prices ≈ 1e9 with unit spread                          | Boundary (max)       | σ exact (shifted sums, no cancellation)      |
 * | W9   | time going backwards (new period)                      | Abnormal             | resets                                       |
 * | W10  | empty / single bar                                     | Boundary (0 / 1)     | length 0 / x, σ 0                            |
 * | W11  | config: anchor choice, bogus anchor, label             | Invalid input        | default session; `VWAP week` label           |
 */
import { describe, expect, it } from '@jest/globals';
import { CandleStore } from '../../data/CandleStore';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import {
  VWAP_LINE,
  VWAP_LOWER_1,
  VWAP_LOWER_2,
  VWAP_UPPER_1,
  VWAP_UPPER_2,
  VWAP_UPPER_3,
  vwapModule,
  type VwapAnchor,
} from '../builtins/Vwap';
import type { IndicatorContext } from '../Indicator';
import { refVwap } from './advancedRefs';
import { columnsOf, expectSeries } from './indicatorTestUtils';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const UTC: IndicatorContext = { timeZone: 'utc' };

function calc(
  c: ReturnType<typeof columnsOf>,
  raw: Record<string, unknown> = {},
  context: IndicatorContext = UTC
) {
  return vwapModule.indicator.calculate(
    c,
    vwapModule.resolveConfig(raw),
    context
  );
}
const col = (r: { outputs: Float64Array[]; length: number }, k = 0) =>
  (r.outputs[k] as Float64Array).subarray(0, r.length);

/** Bars with price `x` (o = h = l = c), `volume` and `time`. */
function bars(xs: number[], volumes: number[], times: number[]) {
  const c = columnsOf(xs);
  c.volume.set(volumes);
  c.time.set(times);
  return c;
}

describe('VWAP', () => {
  it('W1: hand-computed VWAP and band', () => {
    // Given
    const c = bars([10, 20], [1, 3], [0, 60_000]);
    // When
    const r = calc(c);
    // Then
    const sigma = Math.sqrt(18.75);
    expectSeries(col(r, VWAP_LINE), [10, 17.5]);
    expectSeries(col(r, VWAP_UPPER_1), [10, 17.5 + sigma]);
    expectSeries(col(r, VWAP_LOWER_1), [10, 17.5 - sigma]);
  });

  it.each([
    ['session', (t: number) => Math.floor(t / DAY)],
    // Epoch day 0 is a Thursday: +3 aligns weeks on Monday.
    ['week', (t: number) => Math.floor((Math.floor(t / DAY) + 3) / 7)],
    [
      'month',
      (t: number) =>
        new Date(t).getUTCFullYear() * 12 + new Date(t).getUTCMonth(),
    ],
  ] as [VwapAnchor, (t: number) => number][])(
    'W2: generated bars equal the reference (%s)',
    (anchor, periodOf) => {
      // Given: ~70 days of 15m bars
      const store = new CandleStore();
      store.setData(
        generateCandles({ count: 6720, seed: 3, intervalMs: 15 * 60_000 })
      );
      const c = store.columns;
      // When
      const r = calc(c, { anchor, band1: 2 });
      // Then
      const ref = refVwap(c, periodOf, 2);
      expectSeries(col(r, VWAP_LINE), ref.vwap, 1e-9);
      expectSeries(col(r, VWAP_UPPER_1), ref.upper, 1e-7);
      expectSeries(col(r, VWAP_LOWER_1), ref.lower, 1e-7);
    }
  );

  it('W3: the session starts at midnight in the chart time zone', () => {
    // Given: 03:00Z … 06:00Z on Jan 2 = 22:00 … 01:00 in New York (UTC−5)
    const t0 = Date.UTC(2024, 0, 2, 3);
    const c = bars(
      [10, 20, 30, 40],
      [1, 1, 1, 1],
      [0, 1, 2, 3].map((k) => t0 + k * HOUR)
    );
    // When
    const utc = calc(c);
    const ny = calc(c, {}, { timeZone: 'America/New_York' });
    // Then
    expectSeries(col(utc), [10, 15, 20, 25]);
    expectSeries(col(ny), [10, 15, 30, 35]);
  });

  it('W4: fixed offset zone', () => {
    // Given: UTC+9 midnight = 15:00Z
    const t0 = Date.UTC(2024, 0, 2, 14);
    const c = bars([10, 20, 30], [1, 1, 1], [t0, t0 + HOUR, t0 + 2 * HOUR]);
    // When
    const r = calc(c, {}, { timeZone: 540 });
    // Then
    expectSeries(col(r), [10, 20, 25]);
  });

  it('W5: band multipliers (0 = off)', () => {
    // Given
    const c = bars([10, 20], [1, 1], [0, 1]);
    // When
    const off = calc(c, { band1: 0 });
    const on = calc(c, { band2: 2, band3: 3 });
    // Then
    expect(Array.from(col(off, VWAP_UPPER_1)).every(Number.isNaN)).toBe(true);
    expectSeries(col(on, VWAP_UPPER_1), [10, 20]);
    expectSeries(col(on, VWAP_UPPER_2), [10, 25]);
    expectSeries(col(on, VWAP_LOWER_2), [10, 5]);
    expectSeries(col(on, VWAP_UPPER_3), [10, 30]);
  });

  it.each([
    ['time', (c: ReturnType<typeof columnsOf>) => (c.time[1] = NaN)],
    ['price', (c: ReturnType<typeof columnsOf>) => (c.high[1] = NaN)],
    ['volume', (c: ReturnType<typeof columnsOf>) => (c.volume[1] = Infinity)],
  ])('W6: non-finite %s skips the bar', (_, spoil) => {
    // Given
    const c = bars([10, 99, 20], [1, 1, 1], [0, 1, 2]);
    spoil(c);
    // When
    const r = calc(c);
    // Then
    expectSeries(col(r, VWAP_LINE), [10, NaN, 15]);
    expect(Array.from(r.outputs, (o) => o[1])).toEqual(new Array(7).fill(NaN));
  });

  it('W7: zero volume at the period start', () => {
    // Given
    const c = bars([10, 20, 30], [0, 0, 2], [0, 1, 2]);
    // When
    const r = calc(c);
    // Then
    expectSeries(col(r, VWAP_LINE), [NaN, NaN, 30]);
    expectSeries(col(r, VWAP_UPPER_1), [NaN, NaN, 30]);
  });

  it('W8: large prices keep an exact deviation', () => {
    // Given
    const base = 1e9;
    const c = bars([base + 1, base + 2, base + 3], [1, 1, 1], [0, 1, 2]);
    // When
    const r = calc(c);
    // Then
    expect(col(r, VWAP_LINE)[2]).toBe(base + 2);
    expect((col(r, VWAP_UPPER_1)[2] as number) - (base + 2)).toBeCloseTo(
      Math.sqrt(2 / 3),
      6
    );
  });

  it('W9: time going backwards starts a new period', () => {
    // Given
    const c = bars([10, 20, 30], [1, 1, 1], [2 * DAY, 2 * DAY + 1, DAY]);
    // When
    const r = calc(c);
    // Then
    expectSeries(col(r), [10, 15, 30]);
  });

  it('W10: empty input and a single bar; default context', () => {
    // Given / When
    const empty = calc(columnsOf([]));
    const one = vwapModule.indicator.calculate(
      bars([7], [2], [0]),
      vwapModule.resolveConfig({})
    );
    // Then
    expect(empty.length).toBe(0);
    expectSeries(col(one, VWAP_LINE), [7]);
    expectSeries(col(one, VWAP_UPPER_1), [7]);
  });

  it('W11: config, label and metadata', () => {
    // Given / When
    const def = vwapModule.resolveConfig({});
    const week = vwapModule.resolveConfig({ anchor: 'week', source: 'close' });
    const bogus = vwapModule.resolveConfig({ anchor: 'year', band1: -1 });
    // Then
    expect(def).toEqual({
      anchor: 'session',
      source: 'hlc3',
      band1: 1,
      band2: 0,
      band3: 0,
    });
    expect(bogus.anchor).toBe('session');
    expect(bogus.band1).toBe(0);
    expect(vwapModule.formatLabel(def)).toBe('VWAP');
    expect(vwapModule.formatLabel(week)).toBe('VWAP week close');
    expect(vwapModule.meta.usesContext).toBe(true);
    expect(vwapModule.meta.placement).toBe('overlay');
  });
});
