import { IndicatorRegistry } from '../IndicatorRegistry';
import { bollingerModule } from './Bollinger';
import { emaModule, smaModule, wmaModule } from './MovingAverages';

/** Registers the built-in indicators (`sma`, `ema`, `wma`, `bollinger`). */
export function registerBuiltInIndicators(registry: IndicatorRegistry): void {
  registry.register(smaModule, true);
  registry.register(emaModule, true);
  registry.register(wmaModule, true);
  registry.register(bollingerModule, true);
}

/** A new registry pre-filled with the built-in indicators. */
export function createIndicatorRegistry(): IndicatorRegistry {
  const registry = new IndicatorRegistry();
  registerBuiltInIndicators(registry);
  return registry;
}
