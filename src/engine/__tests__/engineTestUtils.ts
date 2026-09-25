import { jest } from '@jest/globals';
import { resolveChartConfig, type ChartConfig } from '../../core/ChartConfig';
import { CandleStore } from '../../data/CandleStore';
import { createUiCandleSeries } from '../../data/UiCandleSeries';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import type { DeepPartial } from '../../utils/deepMerge';
import {
  createChartSharedState,
  toViewportOptions,
  type ChartSharedState,
  type ViewportOptions,
} from '../ChartSharedState';

/** Shared-state fixture: `bars` generated candles, plot 400 × 300 dp. */
export function makeEngine(
  bars = 1000,
  overrides: DeepPartial<ChartConfig> = {}
): {
  state: ChartSharedState;
  options: ViewportOptions;
  store: CandleStore;
} {
  const config = resolveChartConfig(overrides);
  const state = createChartSharedState(config);
  const store = new CandleStore();
  if (bars > 0) {
    store.setData(generateCandles({ count: bars, seed: 1 }));
  }
  state.series.value = createUiCandleSeries(store.columns);
  state.plotWidth.value = 400;
  state.plotHeight.value = 300;
  return { state, options: toViewportOptions(config), store };
}

/** Advances fake timers far enough for any viewport animation to settle. */
export function settle(ms = 5000): void {
  jest.advanceTimersByTime(ms);
}
