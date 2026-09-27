import { adxModule } from '../builtins/Adx';
import { cciModule } from '../builtins/Cci';
import { donchianModule } from '../builtins/Donchian';
import { ichimokuModule } from '../builtins/Ichimoku';
import { keltnerModule } from '../builtins/Keltner';
import { mfiModule } from '../builtins/Mfi';
import { obvModule } from '../builtins/Obv';
import { parabolicSarModule } from '../builtins/ParabolicSar';
import { stochasticModule } from '../builtins/Stochastic';
import { stochRsiModule } from '../builtins/StochRsi';
import { supertrendModule } from '../builtins/Supertrend';
import { vwapModule } from '../builtins/Vwap';
import type { IndicatorModule } from '../IndicatorRegistry';

/** Incremental-property cases of the P10 indicators (defaults + edges). */
export const ADVANCED_CASES: [
  string,
  IndicatorModule,
  Record<string, unknown>,
][] = [
  ['vwap session', vwapModule as IndicatorModule, { band2: 2 }],
  ['vwap week', vwapModule as IndicatorModule, { anchor: 'week' }],
  ['vwap month', vwapModule as IndicatorModule, { anchor: 'month' }],
  ['stoch 14 1 3', stochasticModule as IndicatorModule, {}],
  [
    'stoch 1 1 1',
    stochasticModule as IndicatorModule,
    { kPeriod: 1, kSmoothing: 1, dSmoothing: 1 },
  ],
  ['stoch rsi', stochRsiModule as IndicatorModule, {}],
  [
    'stoch rsi 2 2 3 4',
    stochRsiModule as IndicatorModule,
    { kSmoothing: 2, dSmoothing: 2, rsiPeriod: 3, stochPeriod: 4 },
  ],
  ['obv', obvModule as IndicatorModule, {}],
  ['mfi 14', mfiModule as IndicatorModule, {}],
  ['mfi 1', mfiModule as IndicatorModule, { period: 1 }],
  ['cci 20', cciModule as IndicatorModule, {}],
  ['cci 1', cciModule as IndicatorModule, { period: 1 }],
  ['adx 14 14', adxModule as IndicatorModule, {}],
  ['adx 1 2', adxModule as IndicatorModule, { diPeriod: 1, adxPeriod: 2 }],
  ['donchian 20', donchianModule as IndicatorModule, {}],
  ['donchian 1', donchianModule as IndicatorModule, { period: 1 }],
  ['keltner', keltnerModule as IndicatorModule, {}],
  ['supertrend', supertrendModule as IndicatorModule, {}],
  [
    'supertrend 1 0.5',
    supertrendModule as IndicatorModule,
    { atrPeriod: 1, factor: 0.5 },
  ],
  ['ichimoku', ichimokuModule as IndicatorModule, {}],
  ['sar', parabolicSarModule as IndicatorModule, {}],
  [
    'sar fast',
    parabolicSarModule as IndicatorModule,
    { start: 0.1, increment: 0.1, maximum: 0.5 },
  ],
];
