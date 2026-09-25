import type { PriceRange } from '../src/core/ChartTypes';
import { CandleStore } from '../src/data/CandleStore';
import { generateCandles } from '../src/testing/fixtures/generateCandles';
import { candleRangeMinMax } from '../src/viewport/AutoScale';
import { createPriceScale, priceToY } from '../src/viewport/PriceScale';
import { panRightOffset, type TimeScaleState } from '../src/viewport/TimeScale';
import { getVisibleRange } from '../src/viewport/VisibleRange';
import { bench, check, consume, report } from './harness';

const N = 100_000;
const FRAMES = 10_000;
const WINDOW = 500;
const store = new CandleStore(generateCandles({ count: N, seed: 3 }));

/** One simulated pan frame: pan → visible range → autoscale → scale. */
function frames(barSpacing: number): () => void {
  const range = { startIndex: 0, endIndex: -1 };
  const out: PriceRange = { min: 0, max: 0 };
  return () => {
    const state: TimeScaleState = {
      width: 800,
      barSpacing,
      rightOffset: 0,
      barCount: store.length,
    };
    for (let f = 0; f < FRAMES; f++) {
      state.rightOffset = panRightOffset(state, 3) % (N / 2);
      getVisibleRange(state, 20, range);
      candleRangeMinMax(store.columns, range.startIndex, range.endIndex, out);
      consume(priceToY(createPriceScale(out, 0, 600), out.max));
    }
  };
}

/** Sparse-table alternative, measured to justify the linear scan. */
function buildSparseMax(values: Float64Array): Float64Array[] {
  const levels: Float64Array[] = [values];
  for (let k = 1; 2 ** k <= values.length; k++) {
    const prev = levels[k - 1] as Float64Array;
    const half = 2 ** (k - 1);
    const next = new Float64Array(values.length - 2 ** k + 1);
    for (let i = 0; i < next.length; i++) {
      next[i] = Math.max(prev[i] as number, prev[i + half] as number);
    }
    levels.push(next);
  }
  return levels;
}

export function runViewportBenchmarks(): void {
  bench('frame: pan+range+autoscale+scale, 540 bars', FRAMES, frames(1.6));
  bench('frame: pan+range+autoscale+scale, 1640 bars', FRAMES, frames(0.5));

  const { high, offset, length } = store.columns;
  const values = high.slice(offset, offset + length);
  let table: Float64Array[] = [];
  bench('sparse table build (max only)', N, () => {
    table = buildSparseMax(values);
  });
  check(table.length > 10, 'sparse table levels');
  const k = Math.floor(Math.log2(WINDOW));
  bench('sparse table query, 500 bars', FRAMES, () => {
    const level = table[k] as Float64Array;
    for (let f = 0; f < FRAMES; f++) {
      const s = (f * 37) % (N - WINDOW);
      consume(
        Math.max(level[s] as number, level[s + WINDOW - 2 ** k] as number)
      );
    }
  });
  const out: PriceRange = { min: 0, max: 0 };
  bench('candleRangeMinMax (linear), 500 bars', FRAMES, () => {
    for (let f = 0; f < FRAMES; f++) {
      const s = (f * 37) % (N - WINDOW);
      candleRangeMinMax(store.columns, s, s + WINDOW - 1, out);
      consume(out.max);
    }
  });
  report('Viewport engine (100k bars)');
}
