import {
  formatIndicatorLabel,
  paramDefaults,
  periodParam,
  resolveNumberParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import { readSource } from '../IndicatorSeries';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import { rsiFromAverages } from './Rsi';
import {
  commitWindow,
  createRollingWindow,
  peekWindowSum,
  type RollingWindowState,
} from './RollingWindow';

/**
 * Money Flow Index, TradingView "MFI" (`ta.mfi(hlc3, length)`):
 *
 * - `tp = hlc3`, `flow = tp · volume`;
 * - positive flow when `tp > tp[1]`, negative when `tp < tp[1]` (none on
 *   the first bar, where the change is undefined);
 * - `MFI = 100 − 100 / (1 + Σpositive / Σnegative)` over `period` bars,
 *   100 when there is no negative flow and 0 when there is no positive
 *   flow (same convention as RSI).
 *
 * The first value is at bar `period`. A non-finite bar makes every
 * window holding it (or the next change) `NaN`. Pane indicator, fixed
 * 0–100 scale, 80 / 20 guides. O(1) per tick.
 */
export interface MfiConfig {
  period: number;
}

export interface MfiState {
  /** Typical price of the last committed bar (`NaN` = none / invalid). */
  prevTp: number;
  positive: RollingWindowState;
  negative: RollingWindowState;
}

const PERIOD = periodParam(14);
const PARAMS = [PERIOD];

export const mfiKernel: StepKernel<MfiConfig, MfiState> = {
  type: 'mfi',
  outputs: 1,
  init: ({ period }) => ({
    prevTp: NaN,
    positive: createRollingWindow(period),
    negative: createRollingWindow(period),
  }),
  step(state, input, i, _config, outputs, commit) {
    const tp = readSource(input, i, 'hlc3');
    const flow = tp * (input.volume[input.offset + i] as number);
    const change = tp - state.prevTp;
    let up = NaN;
    let down = NaN;
    if (change - change === 0 && flow - flow === 0) {
      up = change > 0 ? flow : 0;
      down = change < 0 ? flow : 0;
    }
    const positive = peekWindowSum(state.positive, up);
    const negative = peekWindowSum(state.negative, down);
    (outputs[0] as Float64Array)[i] =
      positive - positive === 0 && negative - negative === 0
        ? rsiFromAverages(positive, negative)
        : NaN;
    if (commit) {
      commitWindow(state.positive, up);
      commitWindow(state.negative, down);
      state.prevTp = tp;
    }
  },
};

const meta: IndicatorMeta = {
  type: 'mfi',
  name: 'Money Flow Index',
  shortName: 'MFI',
  placement: 'pane',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [{ key: 'mfi', name: 'MF' }],
  series: [{ kind: 'line', name: 'MF', output: 0, defaultColor: '#7E57C2' }],
  scale: { kind: 'fixed', min: 0, max: 100 },
  valueFormat: { decimals: 2 },
};

export const mfiModule: IndicatorModule<MfiConfig> = {
  meta,
  indicator: createStepIndicator(mfiKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    period: resolveNumberParam(raw, PERIOD),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
  guides: () => ({ levels: [80, 50, 20], band: { upper: 80, lower: 20 } }),
};
