import type { Candle } from '../src/data/Candle';
import { CandleStore } from '../src/data/CandleStore';
import { mergeCandles } from '../src/data/HistoryMerge';
import { RealtimeBarAggregator } from '../src/data/RealtimeBarAggregator';
import { generateCandles } from '../src/testing/fixtures/generateCandles';
import { bench, check, consume, report } from './harness';

const N = 100_000;
const OPS = 10_000;
const candles = generateCandles({ count: N + OPS, seed: 11 });
const base = candles.slice(0, N);
const extra = candles.slice(N);

export function runDataBenchmarks(): void {
  const store = new CandleStore();
  bench('setData 100k (clean input, fast path)', N, () => store.setData(base));
  const reversed = [...base].reverse();
  bench('setData 100k (reversed input → normalize)', N, () =>
    store.setData(reversed)
  );
  check(store.length === N, 'setData length');

  bench(
    'append 10k onto 100k',
    OPS,
    () => {
      for (let i = 0; i < OPS; i++) {
        store.append(extra[i] as Candle);
      }
    },
    { setup: () => store.setData(base) }
  );
  check(store.length === N + OPS, 'append length');
  bench('updateLastValues 10k', OPS, () => {
    for (let i = 0; i < OPS; i++) {
      store.updateLastValues(100, 101 + (i % 7), 99, 100.5, i);
    }
  });

  const agg = new RealtimeBarAggregator(store, { timeframe: '1m' });
  let t = store.lastTime;
  bench('aggregator.addTrade 10k (100 trades per bar)', OPS, () => {
    for (let i = 0; i < OPS; i++) {
      t += 600;
      agg.addTrade(30_000 + (i % 50), 0.01, t);
    }
  });

  const pages: Candle[][] = [];
  for (let p = 0; p < 100; p++) {
    pages.push(base.slice(N - (p + 1) * 1000, N - p * 1000));
  }
  bench(
    'prepend 99 pages × 1000 bars (history scroll)',
    N,
    () => {
      for (let p = 1; p < pages.length; p++) {
        store.prepend(pages[p] as Candle[]);
      }
    },
    { setup: () => store.setData(pages[0] as Candle[]) }
  );
  check(store.length === N, 'prepend length');

  const overlapping = base.slice(N / 2 - 1000, N / 2 + 1);
  bench(
    'mergeCandles 1001-bar page, 1 bar overlap',
    1001,
    () => mergeCandles(store, overlapping),
    { setup: () => store.setData(base.slice(N / 2)) }
  );

  store.setData(base);
  bench('findIndexByTime ×100k in 100k', N, () => {
    let hits = 0;
    for (let i = 0; i < N; i++) {
      hits += store.findIndexByTime((base[(i * 7919) % N] as Candle).time);
    }
    consume(hits);
  });
  report('Data engine');
}
