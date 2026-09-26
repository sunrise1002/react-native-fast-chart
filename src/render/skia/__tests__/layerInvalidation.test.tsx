/**
 * Test perspective table — layer invalidation (P8, spec §17.5)
 * (Skia mocked, real Reanimated, fake timers; fixtures in layerTestUtils;
 * `formatPrice` / `formatTimeTick` wrapped in call counters.)
 *
 * | Case | Input / Precondition                                   | Perspective | Expected                                          |
 * |------|--------------------------------------------------------|-------------|---------------------------------------------------|
 * | LI01 | crosshair index / Y / opacity change                   | Equivalence | candle, axes, indicator, pane-scale frames kept   |
 * | LI02 | pan by 3 bars, price range unchanged                   | Equivalence | new axes frame, no price label reformatted        |
 * | LI03 | same pan again (labels back to cached positions)       | Equivalence | no time label reformatted                         |
 * | LI04 | price range change                                     | Boundary    | new price ticks → labels formatted (cache miss)   |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import * as PriceFormat from '../../../axes/PriceFormat';
import * as TimeFormat from '../../../axes/TimeFormat';
import { createIndicatorDrawList } from '../IndicatorPaints';
import { useAxesLayer } from '../useAxesLayer';
import { useCandlePaths } from '../useCandlePaths';
import { useIndicatorLayer } from '../useIndicatorLayer';
import { usePaneScales } from '../usePaneScales';
import { engine, FONT, PAINTS, tick } from './layerTestUtils';

jest.mock('../../../axes/PriceFormat', () => {
  const actual = jest.requireActual<typeof PriceFormat>(
    '../../../axes/PriceFormat'
  );
  return { ...actual, formatPrice: jest.fn(actual.formatPrice) };
});
jest.mock('../../../axes/TimeFormat', () => {
  const actual = jest.requireActual<typeof TimeFormat>(
    '../../../axes/TimeFormat'
  );
  return { ...actual, formatTimeTick: jest.fn(actual.formatTimeTick) };
});

const formatPrice = PriceFormat.formatPrice as jest.MockedFunction<
  typeof PriceFormat.formatPrice
>;
const formatTimeTick = TimeFormat.formatTimeTick as jest.MockedFunction<
  typeof TimeFormat.formatTimeTick
>;

beforeEach(() => {
  jest.useFakeTimers();
  formatPrice.mockClear();
  formatTimeTick.mockClear();
});

function mountLayers(e = engine()) {
  const drawList = createIndicatorDrawList([]);
  const hook = renderHook(() => {
    const bar = useSharedValue(60_000);
    return {
      candles: useCandlePaths(e.state, {
        bodyRatio: 0.8,
        wickWidth: 1,
        conflationPx: 2,
        pixelRatio: 2,
        profiling: false,
      }),
      axes: useAxesLayer(e.state, bar, {
        font: FONT,
        paints: PAINTS,
        gridLineWidth: 1,
        pixelRatio: 2,
        timeAxisHeight: 24,
        pricePrecision: NaN,
        thousandsSeparator: ',',
        timeZone: 'utc',
        showLastPrice: true,
      }),
      indicators: useIndicatorLayer(e.state, drawList, false),
      paneScales: usePaneScales(e.state, [], 0.2),
    };
  });
  tick();
  return { e, result: hook.result };
}

function frames(r: ReturnType<typeof mountLayers>['result']) {
  return [
    r.current.candles.frame.value,
    r.current.axes.frame.value,
    r.current.indicators.frame.value,
    r.current.paneScales.value,
  ];
}

describe('layer invalidation', () => {
  it('LI01: crosshair moves rebuild none of the static layers', () => {
    // Given
    const { e, result } = mountLayers();
    const before = frames(result);
    // When
    act(() => {
      e.state.crosshairIndex.value = 900;
      e.state.crosshairY.value = 120;
      e.state.crosshairOpacity.value = 1;
    });
    tick();
    // Then
    const after = frames(result);
    after.forEach((frame, i) => expect(frame).toBe(before[i]));
  });

  it('LI02: a pan with an unchanged price range reuses the price labels', () => {
    // Given
    const { e, result } = mountLayers();
    const before = result.current.axes.frame.value;
    expect(formatPrice.mock.calls.length).toBeGreaterThan(0);
    formatPrice.mockClear();
    // When
    act(() => {
      e.state.rightOffset.value = -3;
    });
    tick();
    // Then
    expect(result.current.axes.frame.value).not.toBe(before);
    expect(formatPrice).not.toHaveBeenCalled();
  });

  it('LI03: panning back reuses the time labels', () => {
    // Given: labels of both positions are cached
    const { e, result } = mountLayers();
    act(() => {
      e.state.rightOffset.value = -3;
    });
    tick();
    const panned = result.current.axes.frame.value;
    formatTimeTick.mockClear();
    // When
    act(() => {
      e.state.rightOffset.value = 0;
    });
    tick();
    // Then
    expect(result.current.axes.frame.value).not.toBe(panned);
    expect(formatTimeTick).not.toHaveBeenCalled();
  });

  it('LI04: a new price range formats the new tick labels', () => {
    // Given
    const { e } = mountLayers();
    formatPrice.mockClear();
    // When
    act(() => {
      e.state.priceMin.value = 1;
      e.state.priceMax.value = 1.5;
    });
    tick();
    // Then
    expect(formatPrice.mock.calls.length).toBeGreaterThan(0);
  });
});
