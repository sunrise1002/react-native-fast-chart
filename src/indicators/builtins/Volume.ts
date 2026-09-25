import {
  paramDefaults,
  resolveNumberParam,
  type NumberParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import {
  copyWindowSums,
  createWindowSums,
  stepWindowSums,
  type WindowSums,
} from './WindowSums';

/**
 * Volume (spec §14.8, Phase 10): output 0 is the bar volume itself,
 * output 1 an optional simple moving average of it (`maPeriod`, 0 = off).
 * Drawn as a histogram colored by candle direction, either in its own
 * pane (`'volume'` scale, `0 … max`) or — with `paneId: 'price'` — at the
 * bottom of the price pane (Binance default).
 */
export interface VolumeConfig {
  /** Volume MA length; `0` disables the MA. */
  maPeriod: number;
}

export const VOLUME_VALUE = 0;
export const VOLUME_MA = 1;

const MA_PERIOD: NumberParam = {
  key: 'maPeriod',
  label: 'MA Length',
  kind: 'integer',
  min: 0,
  max: 5000,
  step: 1,
  default: 0,
};
const PARAMS = [MA_PERIOD];

const scratch = createWindowSums();

export const volumeKernel: StepKernel<VolumeConfig, WindowSums> = {
  type: 'volume',
  outputs: 2,
  init: createWindowSums,
  step(state, input, i, { maPeriod }, outputs, commit) {
    const v = input.volume[input.offset + i] as number;
    (outputs[VOLUME_VALUE] as Float64Array)[i] = v - v === 0 ? v : NaN;
    const ma = outputs[VOLUME_MA] as Float64Array;
    if (maPeriod < 1) {
      ma[i] = NaN;
      return;
    }
    const next = scratch;
    stepWindowSums(state, input, i, maPeriod, 'volume', next);
    ma[i] =
      i >= maPeriod - 1 && next.nan === 0
        ? next.shift + next.sum / maPeriod
        : NaN;
    if (commit) {
      copyWindowSums(next, state);
    }
  },
};

const meta: IndicatorMeta = {
  type: 'volume',
  name: 'Volume',
  shortName: 'Vol',
  placement: 'pane',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [
    { key: 'volume', name: 'Volume' },
    { key: 'ma', name: 'Volume MA' },
  ],
  series: [
    {
      kind: 'histogram',
      name: 'Volume',
      output: VOLUME_VALUE,
      colorMode: 'candle',
    },
    { kind: 'line', name: 'MA', output: VOLUME_MA, defaultColor: '#F0B90B' },
  ],
  scale: { kind: 'volume' },
  valueFormat: { compact: true },
};

export const volumeModule: IndicatorModule<VolumeConfig> = {
  meta,
  indicator: createStepIndicator(volumeKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    maPeriod: resolveNumberParam(raw, MA_PERIOD),
  }),
  formatLabel: ({ maPeriod }) =>
    maPeriod > 0 ? `${meta.shortName} ${maPeriod}` : meta.shortName,
};
