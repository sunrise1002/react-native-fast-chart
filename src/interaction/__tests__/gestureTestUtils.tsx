import { jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import { State, type GestureType } from 'react-native-gesture-handler';
import {
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';
import {
  TradingChart,
  type TradingChartProps,
} from '../../components/TradingChart';
import type { ChartConfig } from '../../core/ChartConfig';
import {
  asInternals,
  createTradingChartController,
} from '../../engine/ChartControllerImpl';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import type { DeepPartial } from '../../utils/deepMerge';
import { GESTURE_TEST_IDS } from '../useChartGestures';

/*
 * Gesture test harness: a laid-out chart (plot 400 × 300 dp, 1000 bars,
 * spacing 8, offset 5 → pan bounds [-960, 48]) driven through RNGH's
 * jest utils. The price axis minimum (80 dp) is wider than any label so
 * the auto-sized axis never changes the plot width. Requires
 * `jest.useFakeTimers()`.
 */

export const CANDLES = generateCandles({ count: 1000, seed: 5 });

export function tick(ms = 50) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

export async function chart(
  config?: DeepPartial<ChartConfig>,
  crosshairGesture?: GestureType,
  props: Partial<TradingChartProps> = {}
) {
  const merged: DeepPartial<ChartConfig> = {
    ...config,
    layout: { priceAxisWidth: 80, ...config?.layout },
  };
  const controller = createTradingChartController(merged);
  const view = await render(
    <TradingChart
      testID="chart"
      controller={controller}
      candles={CANDLES}
      config={merged}
      crosshairGesture={crosshairGesture}
      {...props}
    />
  );
  fireEvent(view.getByTestId('chart'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 480, height: 324 } },
  });
  tick();
  return { view, handle: asInternals(controller) };
}

/** Pan through `translations` (dp), then release with `velocityX`. */
export function drag(translations: number[], velocityX = 0) {
  const last = translations[translations.length - 1] ?? 0;
  act(() => {
    fireGestureHandler(getByGestureTestId(GESTURE_TEST_IDS.pan), [
      { state: State.BEGAN, translationX: 0 },
      { state: State.ACTIVE, translationX: 0 },
      ...translations.map((translationX) => ({ translationX })),
      { state: State.END, translationX: last, velocityX },
    ]);
  });
}

export function pinch(scale: number, focalX = 200) {
  act(() => {
    fireGestureHandler(getByGestureTestId(GESTURE_TEST_IDS.pinch), [
      { state: State.BEGAN, scale: 1, focalX },
      { state: State.ACTIVE, scale: 1, focalX },
      { scale, focalX },
      { state: State.END, scale, focalX },
    ]);
  });
}
