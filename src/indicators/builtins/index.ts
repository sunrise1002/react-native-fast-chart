import { IndicatorRegistry } from '../IndicatorRegistry';
import { atrModule } from './Atr';
import { bollingerModule } from './Bollinger';
import { macdModule } from './Macd';
import { emaModule, smaModule, wmaModule } from './MovingAverages';
import { rsiModule } from './Rsi';
import { volumeModule } from './Volume';

/**
 * Registers the built-in indicators: overlays `sma`, `ema`, `wma`,
 * `bollinger`; pane indicators `volume`, `rsi`, `macd`, `atr`.
 */
export function registerBuiltInIndicators(registry: IndicatorRegistry): void {
  registry.register(smaModule, true);
  registry.register(emaModule, true);
  registry.register(wmaModule, true);
  registry.register(bollingerModule, true);
  registry.register(volumeModule, true);
  registry.register(rsiModule, true);
  registry.register(macdModule, true);
  registry.register(atrModule, true);
}

/** A new registry pre-filled with the built-in indicators. */
export function createIndicatorRegistry(): IndicatorRegistry {
  const registry = new IndicatorRegistry();
  registerBuiltInIndicators(registry);
  return registry;
}
