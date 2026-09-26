import { paramDefaults, type RawIndicatorConfig } from '../IndicatorConfig';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';

/**
 * On Balance Volume, TradingView "OBV":
 * `obv = cum(sign(close − close[1]) · volume)`, starting at 0 on the first
 * bar. A bar with a non-finite close or volume has no value and is
 * skipped (the next change is taken against the last finite close).
 * Pane indicator, auto scale, compact K / M / B values. O(1) per tick.
 */
export type ObvConfig = Record<string, never>;

export interface ObvState {
  /** Close of the last committed finite bar (`NaN` before the first). */
  prevClose: number;
  total: number;
}

export const obvKernel: StepKernel<ObvConfig, ObvState> = {
  type: 'obv',
  outputs: 1,
  init: () => ({ prevClose: NaN, total: 0 }),
  step(state, input, i, _config, outputs, commit) {
    const p = input.offset + i;
    const close = input.close[p] as number;
    const volume = input.volume[p] as number;
    const out = outputs[0] as Float64Array;
    if (!(close - close === 0) || !(volume - volume === 0)) {
      out[i] = NaN;
      return;
    }
    const prev = state.prevClose;
    const change = close - prev;
    const value =
      change > 0
        ? state.total + volume
        : change < 0
          ? state.total - volume
          : state.total;
    out[i] = value;
    if (commit) {
      state.total = value;
      state.prevClose = close;
    }
  },
};

const meta: IndicatorMeta = {
  type: 'obv',
  name: 'On Balance Volume',
  shortName: 'OBV',
  placement: 'pane',
  params: [],
  defaultConfig: paramDefaults([]),
  outputs: [{ key: 'obv', name: 'OBV' }],
  series: [{ kind: 'line', name: 'OBV', output: 0, defaultColor: '#2962FF' }],
  scale: { kind: 'auto' },
  valueFormat: { compact: true },
};

const EMPTY_CONFIG: ObvConfig = Object.freeze({});

export const obvModule: IndicatorModule<ObvConfig> = {
  meta,
  indicator: createStepIndicator(obvKernel),
  resolveConfig: (_raw: RawIndicatorConfig | null | undefined) => EMPTY_CONFIG,
  formatLabel: () => meta.shortName,
};
