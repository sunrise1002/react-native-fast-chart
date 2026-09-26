import {
  formatIndicatorLabel,
  paramDefaults,
  periodParam,
  resolveNumberParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import {
  createRollingExtreme,
  stepExtreme,
  type RollingExtremeState,
} from './RollingExtremes';

/**
 * Donchian Channels, TradingView "DC": `upper = highest(high, n)`,
 * `lower = lowest(low, n)`, `basis = (upper + lower) / 2`, `n = 20`.
 * Overlay band on the price scale. O(1) per tick (monotonic deques).
 */
export interface DonchianConfig {
  period: number;
}

export interface DonchianState {
  highest: RollingExtremeState;
  lowest: RollingExtremeState;
}

/** Output column order (shared by the channel overlays). */
export const CHANNEL_UPPER = 0;
export const CHANNEL_BASIS = 1;
export const CHANNEL_LOWER = 2;

/** Outputs / series of an upper / basis / lower channel overlay. */
export function channelSeries(
  basisColor: string,
  bandColor: string
): Pick<IndicatorMeta, 'outputs' | 'series'> {
  return {
    outputs: [
      { key: 'upper', name: 'Upper' },
      { key: 'basis', name: 'Basis' },
      { key: 'lower', name: 'Lower' },
    ],
    series: [
      {
        kind: 'line',
        name: 'Basis',
        output: CHANNEL_BASIS,
        defaultColor: basisColor,
      },
      {
        kind: 'band',
        name: 'Channel',
        upper: CHANNEL_UPPER,
        lower: CHANNEL_LOWER,
        defaultColor: bandColor,
      },
    ],
  };
}

const PERIOD = periodParam(20);
const PARAMS = [PERIOD];

export const donchianKernel: StepKernel<DonchianConfig, DonchianState> = {
  type: 'donchian',
  outputs: 3,
  init: ({ period }) => ({
    highest: createRollingExtreme(period, 1),
    lowest: createRollingExtreme(period, -1),
  }),
  step(state, input, i, _config, outputs, commit) {
    const p = input.offset + i;
    const upper = stepExtreme(
      state.highest,
      i,
      input.high[p] as number,
      commit
    );
    const lower = stepExtreme(state.lowest, i, input.low[p] as number, commit);
    (outputs[CHANNEL_UPPER] as Float64Array)[i] = upper;
    (outputs[CHANNEL_LOWER] as Float64Array)[i] = lower;
    (outputs[CHANNEL_BASIS] as Float64Array)[i] = (upper + lower) / 2;
  },
};

const meta: IndicatorMeta = {
  type: 'donchian',
  name: 'Donchian Channels',
  shortName: 'DC',
  placement: 'overlay',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  ...channelSeries('#FF6D00', '#2962FF'),
};

export const donchianModule: IndicatorModule<DonchianConfig> = {
  meta,
  indicator: createStepIndicator(donchianKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    period: resolveNumberParam(raw, PERIOD),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
};
