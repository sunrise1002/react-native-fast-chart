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
import { isFiniteValue, readSource } from '../IndicatorSeries';
import type { IndicatorMeta, IndicatorModule } from '../IndicatorRegistry';
import { createStepIndicator, type StepKernel } from '../StepIndicator';
import {
  copyWindowSums,
  createWindowSums,
  stepWindowSums,
  type WindowSums,
} from './WindowSums';

/*
 * Moving averages (spec §14.1–14.3, Phase 8.1–8.3): SMA, EMA, WMA.
 * All three update in O(1) per realtime tick.
 */

/** Resolved config shared by the moving averages. */
export interface MovingAverageConfig {
  /** Window length in bars, integer `>= 1`. */
  period: number;
  source: PriceSource;
}

/** TradingView's default length for SMA / EMA / WMA. */
export const DEFAULT_MA_PERIOD = 9;

const PERIOD = periodParam(DEFAULT_MA_PERIOD);
const SOURCE = sourceParam('close');
const MA_PARAMS = [PERIOD, SOURCE];

function resolveMaConfig(
  raw: RawIndicatorConfig | null | undefined
): MovingAverageConfig {
  return {
    period: resolveNumberParam(raw, PERIOD),
    source: resolveSourceParam(raw, SOURCE),
  };
}

function maMeta(type: string, name: string, shortName: string): IndicatorMeta {
  return {
    type,
    name,
    shortName,
    placement: 'overlay',
    params: MA_PARAMS,
    defaultConfig: paramDefaults(MA_PARAMS),
    outputs: [{ key: 'value', name: shortName }],
    series: [{ kind: 'line', name: shortName, output: 0 }],
  };
}

function maModule<TState>(
  meta: IndicatorMeta,
  kernel: StepKernel<MovingAverageConfig, TState>
): IndicatorModule<MovingAverageConfig> {
  return {
    meta,
    indicator: createStepIndicator(kernel),
    resolveConfig: resolveMaConfig,
    formatLabel: (config) =>
      formatIndicatorLabel(meta.shortName, meta.params, { ...config }),
  };
}

/* ----------------------------------- SMA ----------------------------------- */

const smaScratch = createWindowSums();

export const smaKernel: StepKernel<MovingAverageConfig, WindowSums> = {
  type: 'sma',
  outputs: 1,
  init: createWindowSums,
  step(state, input, i, { period, source }, outputs, commit) {
    const next = smaScratch;
    stepWindowSums(state, input, i, period, source, next);
    (outputs[0] as Float64Array)[i] =
      i >= period - 1 && next.nan === 0 ? next.shift + next.sum / period : NaN;
    if (commit) {
      copyWindowSums(next, state);
    }
  },
};

/* ----------------------------------- WMA ----------------------------------- */

const wmaScratch = createWindowSums();

/** Linearly weighted: newest bar weight `period`, oldest weight 1. */
export const wmaKernel: StepKernel<MovingAverageConfig, WindowSums> = {
  type: 'wma',
  outputs: 1,
  init: createWindowSums,
  step(state, input, i, { period, source }, outputs, commit) {
    const next = wmaScratch;
    stepWindowSums(state, input, i, period, source, next);
    const weights = (period * (period + 1)) / 2;
    (outputs[0] as Float64Array)[i] =
      i >= period - 1 && next.nan === 0
        ? next.shift + next.weighted / weights
        : NaN;
    if (commit) {
      copyWindowSums(next, state);
    }
  },
};

/* ----------------------------------- EMA ----------------------------------- */

export interface EmaState {
  /** EMA of the last committed finite bar (after seeding). */
  ema: number;
  /** Sum / count of the finite values collected while seeding. */
  seedSum: number;
  seedCount: number;
}

/**
 * `alpha = 2 / (period + 1)`, `EMA_t = price_t·alpha + EMA_(t−1)·(1 − alpha)`.
 * Seeded TradingView-style (Pine `ta.ema`): the first value is the SMA of
 * the first `period` finite inputs, so the first `period − 1` bars have no
 * value. A non-finite input yields no value for that bar and is skipped
 * (the recursion continues from the previous EMA).
 */
export const emaKernel: StepKernel<MovingAverageConfig, EmaState> = {
  type: 'ema',
  outputs: 1,
  init: () => ({ ema: NaN, seedSum: 0, seedCount: 0 }),
  step(state, input, i, { period, source }, outputs, commit) {
    const out = outputs[0] as Float64Array;
    const x = readSource(input, i, source);
    if (!isFiniteValue(x)) {
      out[i] = NaN;
      return;
    }
    if (state.seedCount < period) {
      const sum = state.seedSum + x;
      const count = state.seedCount + 1;
      const value = count === period ? sum / period : NaN;
      out[i] = value;
      if (commit) {
        state.seedSum = sum;
        state.seedCount = count;
        state.ema = value;
      }
      return;
    }
    const alpha = 2 / (period + 1);
    const value = x * alpha + state.ema * (1 - alpha);
    out[i] = value;
    if (commit) {
      state.ema = value;
    }
  },
};

export const smaModule = maModule(
  maMeta('sma', 'Simple Moving Average', 'SMA'),
  smaKernel
);
export const emaModule = maModule(
  maMeta('ema', 'Exponential Moving Average', 'EMA'),
  emaKernel
);
export const wmaModule = maModule(
  maMeta('wma', 'Weighted Moving Average', 'WMA'),
  wmaKernel
);
