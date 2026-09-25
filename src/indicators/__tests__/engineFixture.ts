import { jest } from '@jest/globals';
import { CandleStore } from '../../data/CandleStore';
import type { RenderProfiler } from '../../performance/RenderProfiler';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import { emaModule } from '../builtins/MovingAverages';
import type { createIndicatorRegistry } from '../builtins';
import type { IndicatorUpdate } from '../IndicatorCompute';
import { IndicatorEngine } from '../IndicatorEngine';

/* Engine fixture: 300 generated bars, manual frames, spy profiler. */
export const BARS = generateCandles({ count: 300, seed: 2 });

export function setup(
  options: {
    bars?: typeof BARS;
    registry?: ReturnType<typeof createIndicatorRegistry>;
  } = {}
) {
  const store = new CandleStore(options.bars ?? BARS);
  const frames: (() => void)[] = [];
  const profiler: RenderProfiler = {
    begin: jest.fn(() => 1),
    end: jest.fn(),
  } as unknown as RenderProfiler;
  const engine = new IndicatorEngine(store, {
    requestFrame: (cb) => {
      frames.push(cb);
    },
    registry: options.registry,
    getProfiler: () => profiler,
  });
  const updates: IndicatorUpdate[][] = [];
  engine.subscribeResults((u) => updates.push([...u]));
  const fire = () => frames.splice(0).forEach((cb) => cb());
  return { store, engine, frames, fire, updates, profiler };
}

export const ema = (store: CandleStore, period: number) =>
  emaModule.indicator.calculate(store.columns, { period, source: 'close' });

export const last = <T>(xs: readonly T[]): T => xs[xs.length - 1] as T;
