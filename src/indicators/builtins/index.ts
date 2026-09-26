import { IndicatorRegistry } from '../IndicatorRegistry';
import { adxModule } from './Adx';
import { atrModule } from './Atr';
import { bollingerModule } from './Bollinger';
import { cciModule } from './Cci';
import { donchianModule } from './Donchian';
import { ichimokuModule } from './Ichimoku';
import { keltnerModule } from './Keltner';
import { macdModule } from './Macd';
import { mfiModule } from './Mfi';
import { emaModule, smaModule, wmaModule } from './MovingAverages';
import { obvModule } from './Obv';
import { parabolicSarModule } from './ParabolicSar';
import { rsiModule } from './Rsi';
import { stochasticModule } from './Stochastic';
import { stochRsiModule } from './StochRsi';
import { supertrendModule } from './Supertrend';
import { volumeModule } from './Volume';
import { vwapModule } from './Vwap';

/**
 * Registers the built-in indicators: overlays `sma`, `ema`, `wma`,
 * `bollinger`, `vwap`, `donchian`, `keltner`, `supertrend`, `ichimoku`,
 * `parabolicSar`; pane indicators `volume`, `rsi`, `macd`, `atr`,
 * `stochastic`, `stochRsi`, `obv`, `mfi`, `cci`, `adx`.
 */
export function registerBuiltInIndicators(registry: IndicatorRegistry): void {
  registry.register(smaModule, true);
  registry.register(emaModule, true);
  registry.register(wmaModule, true);
  registry.register(bollingerModule, true);
  registry.register(vwapModule, true);
  registry.register(donchianModule, true);
  registry.register(keltnerModule, true);
  registry.register(supertrendModule, true);
  registry.register(ichimokuModule, true);
  registry.register(parabolicSarModule, true);
  registry.register(volumeModule, true);
  registry.register(rsiModule, true);
  registry.register(macdModule, true);
  registry.register(atrModule, true);
  registry.register(stochasticModule, true);
  registry.register(stochRsiModule, true);
  registry.register(obvModule, true);
  registry.register(mfiModule, true);
  registry.register(cciModule, true);
  registry.register(adxModule, true);
}

/** A new registry pre-filled with the built-in indicators. */
export function createIndicatorRegistry(): IndicatorRegistry {
  const registry = new IndicatorRegistry();
  registerBuiltInIndicators(registry);
  return registry;
}
