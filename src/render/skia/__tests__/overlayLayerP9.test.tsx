/**
 * Test perspective table — useOverlayLayer precision / formatter options (P9)
 * (Skia mocked; fixtures in layerTestUtils)
 *
 * | Case | Input / Precondition                                 | Perspective        | Expected                                   |
 * |------|------------------------------------------------------|--------------------|--------------------------------------------|
 * | OP1  | priceFormatter + timeFormatter, crosshair shown      | Equivalence        | both crosshair labels + legend O/H/L/C     |
 * | OP2  | timeFormatter gets weight TIME_LABEL_CROSSHAIR (0)   | Equivalence        | (localTime, 0, barMs)                      |
 * | OP3  | volumeDecimals 3 on a fractional volume              | Equivalence        | legend volume with 3 decimals              |
 * | OP4  | daily bars at +9 h, dailyBarsTimeZone utc / chart    | Equivalence        | crosshair date differs by the zone         |
 * | OP5  | throwing formatters                                  | Abnormal           | built-in labels                            |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  TIME_LABEL_CROSSHAIR,
  type PriceFormatter,
  type TimeFormatter,
} from '../../../axes/Formatters';
import { showCrosshair } from '../../../engine/CrosshairActions';
import { useOverlayLayer, type OverlayStyle } from '../useOverlayLayer';
import { engine, FONT, PAINTS, pic, tick } from './layerTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const DAY = 86_400_000;
const OVERLAY: OverlayStyle = {
  font: FONT,
  paints: PAINTS,
  pixelRatio: 2,
  timeAxisHeight: 24,
  pricePrecision: NaN,
  thousandsSeparator: '',
  timeZone: 'utc',
  showLegend: true,
  showLegendVolume: true,
};

function overlay(
  e = engine(),
  style: Partial<OverlayStyle> = {},
  barMs = 60_000
) {
  const view = renderHook(() => {
    const bar = useSharedValue(barMs);
    return useOverlayLayer(e.state, bar, { ...OVERLAY, ...style });
  });
  act(() => showCrosshair(e.state, 200, 150));
  tick();
  return {
    crosshair: () => pic(view.result.current.crosshair).texts(),
    legend: () => pic(view.result.current.legend).texts(),
  };
}

const PRICE: PriceFormatter = (p, d) => `$${p.toFixed(d)}`;

describe('useOverlayLayer P9 options', () => {
  it('OP1: formatters drive crosshair labels and the legend', () => {
    // Given / When
    const view = overlay(engine(), {
      priceFormatter: PRICE,
      timeFormatter: () => 'T',
    });
    // Then
    const [price, time] = view.crosshair();
    expect(price?.startsWith('$')).toBe(true);
    expect(time).toBe('T');
    expect(view.legend().filter((t) => t.startsWith('$'))).toHaveLength(4);
  });

  it('OP2: the crosshair time label uses weight 0', () => {
    // Given
    const fmt = jest.fn<TimeFormatter>(() => 'x');
    // When
    overlay(engine(), { timeFormatter: fmt });
    // Then
    const [t, weight, barMs] = fmt.mock.calls[0] ?? [];
    expect(Number.isFinite(t)).toBe(true);
    expect(weight).toBe(TIME_LABEL_CROSSHAIR);
    expect(barMs).toBe(60_000);
  });

  it('OP3: legend volume uses volumeDecimals', () => {
    // Given
    const e = engine();
    const s = e.state.series.value;
    s.volume.fill(12.3456);
    // When
    const view = overlay(e, { volumeDecimals: 3 });
    // Then
    expect(view.legend()).toContain('12.346');
  });

  it('OP4: daily crosshair dates follow dailyBarsTimeZone', () => {
    // Given: bars open at 00:00 UTC+9
    const daily = () => {
      const e = engine();
      const s = e.state.series.value;
      for (let i = 0; i < s.length; i++) {
        s.time[s.offset + i] = Date.UTC(2020, 0, 1) + i * DAY - 9 * 3_600_000;
      }
      return e;
    };
    // When
    const utc = overlay(daily(), { timeZone: 540 }, DAY).crosshair()[1];
    const chart = overlay(
      daily(),
      { timeZone: 540, dailyBarsTimeZone: 'chart' },
      DAY
    ).crosshair()[1];
    // Then
    expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(chart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const days = (Date.parse(chart ?? '') - Date.parse(utc ?? '')) / DAY;
    expect(days).toBe(1);
  });

  it('OP5: throwing formatters fall back', () => {
    // Given
    const boom = () => {
      throw new Error('boom');
    };
    // When
    const view = overlay(engine(), {
      priceFormatter: boom,
      timeFormatter: boom,
    });
    // Then
    const [price, time] = view.crosshair();
    expect(price).toMatch(/^\d+(\.\d+)?$/);
    expect(time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
