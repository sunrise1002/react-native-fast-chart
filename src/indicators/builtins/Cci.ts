import type { PriceSource } from '../Indicator';
import {
  formatIndicatorLabel,
  paramDefaults,
  periodParam,
  resolveNumberParam,
  resolveSourceParam,
  sourceParam,
  type RawIndicatorConfig,
} from '../IndicatorConfig';
import { readSource } from '../IndicatorSeries';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import {
  commitWindow,
  createRollingWindow,
  peekWindowSum,
  windowValue,
  type RollingWindowState,
} from './RollingWindow';

/**
 * Commodity Channel Index, TradingView "CCI":
 * `CCI = (x − SMA(x, n)) / (0.015 · meanDeviation(x, n))` with
 * `meanDeviation = Σ|x_j − SMA| / n` (Pine `ta.dev`), `x = hlc3` by
 * default, `n = 20`. `NaN` for a flat window (zero deviation) and while
 * the window holds a non-finite value. The mean deviation needs the whole
 * window, so a tick costs O(n) (like Pine); the SMA is a running sum.
 * Pane indicator, auto scale, ±100 guides.
 */
export interface CciConfig {
  period: number;
  source: PriceSource;
}

/** Lambert's constant: ~70–80 % of values fall within ±100. */
export const CCI_CONSTANT = 0.015;

const PERIOD = periodParam(20);
const SOURCE = sourceParam('hlc3');
const PARAMS = [PERIOD, SOURCE];

export const cciKernel: StepKernel<CciConfig, RollingWindowState> = {
  type: 'cci',
  outputs: 1,
  init: ({ period }) => createRollingWindow(period),
  step(state, input, i, { period, source }, outputs, commit) {
    const x = readSource(input, i, source);
    const mean = peekWindowSum(state, x) / period;
    let value = NaN;
    if (mean - mean === 0) {
      let dev = 0;
      for (let age = 0; age < period; age++) {
        dev += Math.abs(windowValue(state, x, age) - mean);
      }
      dev /= period;
      value = dev > 0 ? (x - mean) / (CCI_CONSTANT * dev) : NaN;
    }
    (outputs[0] as Float64Array)[i] = value;
    if (commit) {
      commitWindow(state, x);
    }
  },
};

const meta: IndicatorMeta = {
  type: 'cci',
  name: 'Commodity Channel Index',
  shortName: 'CCI',
  placement: 'pane',
  params: PARAMS,
  defaultConfig: paramDefaults(PARAMS),
  outputs: [{ key: 'cci', name: 'CCI' }],
  series: [{ kind: 'line', name: 'CCI', output: 0, defaultColor: '#2962FF' }],
  scale: { kind: 'auto' },
  valueFormat: { decimals: 2 },
};

export const cciModule: IndicatorModule<CciConfig> = {
  meta,
  indicator: createStepIndicator(cciKernel),
  resolveConfig: (raw: RawIndicatorConfig | null | undefined) => ({
    period: resolveNumberParam(raw, PERIOD),
    source: resolveSourceParam(raw, SOURCE),
  }),
  formatLabel: (config) =>
    formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
  guides: () => ({ levels: [100, 0, -100], band: { upper: 100, lower: -100 } }),
};
