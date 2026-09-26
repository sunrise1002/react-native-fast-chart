/**
 * Test perspective table — useAxesLayer precision / time-zone options (P9)
 * (Skia mocked; fixtures in layerTestUtils: 1000 × 1 m bars, plot 400 × 300)
 *
 * | Case | Input / Precondition                                 | Perspective        | Expected                                    |
 * |------|------------------------------------------------------|--------------------|---------------------------------------------|
 * | AP1  | tickSize 0.25                                        | Equivalence        | every price label a multiple of 0.25        |
 * | AP2  | priceFormatter (worklet-style)                       | Equivalence        | price labels + badge use it                 |
 * | AP3  | priceFormatter throwing                              | Abnormal           | built-in labels                             |
 * | AP4  | timeFormatter                                        | Equivalence        | time labels use it, get (t, weight, barMs)  |
 * | AP5  | daily bars at +9 h midnights, dailyBarsTimeZone utc  | Equivalence        | labels on UTC dates                         |
 * | AP6  | same bars, dailyBarsTimeZone 'chart', zone +540      | Equivalence        | labels on zone dates (differ from AP5)      |
 * | AP7  | IANA chart zone on intraday bars                     | Equivalence        | labels shifted by the zone offset           |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { PriceFormatter, TimeFormatter } from '../../../axes/Formatters';
import { useAxesLayer, type AxesStyle } from '../useAxesLayer';
import { engine, FONT, PAINTS, pic, tick } from './layerTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const DAY = 86_400_000;
const AXES: AxesStyle = {
  font: FONT,
  paints: PAINTS,
  gridLineWidth: 1,
  pixelRatio: 2,
  timeAxisHeight: 24,
  pricePrecision: NaN,
  thousandsSeparator: '',
  timeZone: 'utc',
  showLastPrice: true,
};

function axes(e = engine(), style: Partial<AxesStyle> = {}, barMs = 60_000) {
  return renderHook(() => {
    const bar = useSharedValue(barMs);
    return useAxesLayer(e.state, bar, { ...AXES, ...style });
  });
}

/** Text ops of the price axis (right gutter) / time axis (bottom). */
function labels(e: ReturnType<typeof axes>) {
  const ops = pic(e.result.current.picture).ops;
  const texts = ops.flatMap((o) => (o.op === 'text' ? [o] : []));
  return {
    price: texts.filter((o) => o.y <= 300).map((o) => o.text),
    time: texts.filter((o) => o.y > 300).map((o) => o.text),
  };
}

function dailyEngine(offsetMs: number) {
  const e = engine(120);
  const s = e.state.series.value;
  for (let i = 0; i < s.length; i++) {
    s.time[s.offset + i] = Date.UTC(2020, 0, 1) + i * DAY - offsetMs;
  }
  return e;
}

describe('useAxesLayer P9 options', () => {
  it('AP1: price labels are tick-size multiples', () => {
    // Given
    const e = engine();
    e.state.priceMin.value = 100;
    e.state.priceMax.value = 101.3;
    e.state.series.value.close[999] = 100.5;
    // When
    const view = axes(e, { tickSize: 0.25, showLastPrice: false });
    tick();
    // Then
    const prices = labels(view).price.map(Number);
    expect(prices.length).toBeGreaterThan(1);
    for (const p of prices) {
      expect(Math.abs(p / 0.25 - Math.round(p / 0.25))).toBeLessThan(1e-9);
    }
  });

  it('AP2: priceFormatter formats axis labels and the badge', () => {
    // Given
    const fmt: PriceFormatter = (price, decimals) => {
      'worklet';
      return `$${price.toFixed(decimals)}`;
    };
    // When
    const view = axes(engine(), { priceFormatter: fmt });
    tick();
    // Then
    const { price } = labels(view);
    expect(price.length).toBeGreaterThan(1);
    expect(price.every((t) => t.startsWith('$'))).toBe(true);
  });

  it('AP3: a throwing priceFormatter falls back', () => {
    // Given
    const fmt: PriceFormatter = () => {
      throw new Error('bad formatter');
    };
    // When
    const view = axes(engine(), { priceFormatter: fmt });
    tick();
    // Then
    const { price } = labels(view);
    expect(price.length).toBeGreaterThan(1);
    expect(price.every((t) => /^-?\d+(\.\d+)?$/.test(t))).toBe(true);
  });

  it('AP4: timeFormatter formats time labels', () => {
    // Given
    const calls: [number, number, number][] = [];
    const fmt: TimeFormatter = (t, weight, barMs) => {
      calls.push([t, weight, barMs]);
      return `w${weight}`;
    };
    // When
    const view = axes(engine(), { timeFormatter: fmt });
    tick();
    // Then
    const { time } = labels(view);
    expect(time.length).toBeGreaterThan(0);
    expect(time.every((t) => /^w[1-4]$/.test(t))).toBe(true);
    expect(calls[0]?.[2]).toBe(60_000);
  });

  it('AP5/AP6: daily bars follow dailyBarsTimeZone', () => {
    // Given: bars open at 00:00 UTC+9 (15:00Z of the previous day)
    const utc = axes(dailyEngine(9 * 3_600_000), { timeZone: 540 }, DAY);
    const chart = axes(
      dailyEngine(9 * 3_600_000),
      { timeZone: 540, dailyBarsTimeZone: 'chart' },
      DAY
    );
    // When
    tick();
    // Then
    const a = labels(utc).time;
    const b = labels(chart).time;
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(b).not.toEqual(a);
    expect(b.every((t) => /^(\d{1,2}|[A-Z][a-z]{2}|\d{4})$/.test(t))).toBe(
      true
    );
  });

  it('AP7: IANA zones shift intraday labels', () => {
    // Given
    const utc = axes(engine(), { timeZone: 'utc' });
    const tokyo = axes(engine(), { timeZone: 'Asia/Tokyo' });
    // When
    tick();
    // Then
    const shift = (text: string | undefined) => {
      const [h, m] = (text ?? '').split(':').map(Number);
      return ((h as number) * 60 + (m as number)) % 1440;
    };
    const a = labels(utc).time.filter((t) => t.includes(':'));
    const b = labels(tokyo).time.filter((t) => t.includes(':'));
    expect(a.length).toBeGreaterThan(0);
    expect((shift(b[0]) - shift(a[0]) + 1440) % 1440).toBe(540);
  });
});
