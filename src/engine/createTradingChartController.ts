import { useState } from 'react';
import { resolveChartConfig, type ChartConfig } from '../core/ChartConfig';
import type { DeepPartial } from '../utils/deepMerge';
import { ChartController } from './ChartControllerImpl';
import type {
  ChartControllerInternals,
  TradingChartHandle,
} from './ChartHandle';

export type {
  ChartControllerInternals,
  TradingChartHandle,
} from './ChartHandle';

/** Creates a chart handle outside React (e.g. in a store / service). */
export function createTradingChartController(
  config?: DeepPartial<ChartConfig> | null
): TradingChartHandle {
  return new ChartController(resolveChartConfig(config));
}

/**
 * Creates a stable chart handle for a host component; pass it to
 * `<TradingChart controller={...} />`. The config only seeds the initial
 * viewport; the chart's `config` prop stays authoritative.
 *
 * Not disposed automatically: every subscription the chart component
 * makes is released on unmount, and the handle only references its own
 * parts, so it is garbage-collected with the host (auto-disposal would
 * also break StrictMode's mount → unmount → mount check).
 */
export function useTradingChartController(
  config?: DeepPartial<ChartConfig> | null
): TradingChartHandle {
  return useState(() => createTradingChartController(config))[0];
}

/** Narrows a public handle to the internals the component needs. */
export function asInternals(
  handle: TradingChartHandle
): ChartControllerInternals {
  return handle as ChartControllerInternals;
}
