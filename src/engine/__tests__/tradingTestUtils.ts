import { resolveChartConfig } from '../../core/ChartConfig';
import { CandleStore } from '../../data/CandleStore';
import { createUiCandleSeries } from '../../data/UiCandleSeries';
import { bars } from '../../data/__tests__/bars';
import { TradingOverlayStore } from '../../trading/TradingOverlayStore';
import {
  createChartSharedState,
  type ChartSharedState,
} from '../ChartSharedState';
import { applyTradingScene } from '../TradingState';

/**
 * 10 one-minute bars (`T0 + i min`, close `100 + i`) on a 400 × 300 plot:
 * `x(i) = 305 + 10 i`, `y(price) = 300 − price`, price axis 60 dp.
 */
export function makeTradingEngine(count = 10): {
  state: ChartSharedState;
  overlays: TradingOverlayStore;
  sync: () => void;
} {
  const state = createChartSharedState(resolveChartConfig({}));
  const store = new CandleStore();
  if (count > 0) {
    store.setData(bars(0, count - 1));
  }
  state.series.value = createUiCandleSeries(store.columns);
  state.plotWidth.value = 400;
  state.plotHeight.value = 300;
  state.barSpacing.value = 10;
  state.rightOffset.value = 0;
  state.priceMin.value = 0;
  state.priceMax.value = 300;
  state.priceAxisWidth.value = 60;
  const overlays = new TradingOverlayStore();
  const sync = () => applyTradingScene(state, overlays.getScene());
  return { state, overlays, sync };
}

/** Writes a hit map entry `[y, boxLeft, boxRight]` per scene line. */
export function setHits(
  state: ChartSharedState,
  lines: readonly (readonly [number, number, number])[]
): void {
  state.tradingHits.value = {
    version: state.tradingScene.value.version,
    count: lines.length,
    lines: lines.flatMap((l) => [...l]),
  };
}
