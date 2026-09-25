import { CandleStore } from '../src/data/CandleStore';
import { createUiCandleSeries } from '../src/data/UiCandleSeries';
import { bollingerModule } from '../src/indicators/builtins/Bollinger';
import {
  emaModule,
  smaModule,
  wmaModule,
} from '../src/indicators/builtins/MovingAverages';
import type { IndicatorModule } from '../src/indicators/IndicatorRegistry';
import type { IndicatorUpdate } from '../src/indicators/IndicatorCompute';
import { IndicatorEngine } from '../src/indicators/IndicatorEngine';
import {
  applyIndicatorPayloads,
  emptyUiIndicatorSet,
  packIndicatorUpdate,
} from '../src/indicators/UiIndicatorSet';
import {
  buildBandFill,
  buildLineGeometry,
  type FillPathSink,
} from '../src/render/indicators/LineGeometry';
import { generateCandles } from '../src/testing/fixtures/generateCandles';
import { candleRangeMinMax } from '../src/viewport/AutoScale';
import { createPriceScale } from '../src/viewport/PriceScale';
import type { TimeScaleState } from '../src/viewport/TimeScale';
import { getVisibleRange } from '../src/viewport/VisibleRange';
import { bench, check, consume, report } from './harness';

/*
 * Spec §36 gate scenario: 10k candles, ~200 visible, EMA 20 + EMA 50,
 * 10–20 realtime updates / s. Measures the JS-thread work per tick
 * (store update → incremental indicator flush → UI payload pack/apply)
 * and the UI-thread geometry per frame (visible slice → path commands).
 */

const TICKS = 2_000;
const FRAMES = 2_000;
const VISIBLE = 200;

const pathSink: FillPathSink = {
  moveTo: (x, y) => consume(x + y),
  lineTo: (x, y) => consume(x + y),
  close: () => consume(1),
};

function fullCalc(
  module: IndicatorModule,
  count: number,
  raw: Readonly<Record<string, unknown>>
) {
  const store = new CandleStore(generateCandles({ count, seed: 9 }));
  const config = module.resolveConfig(raw);
  return () => {
    const r = module.indicator.calculate(store.columns, config);
    check(r.length === count, 'full length');
    consume(r.outputs[0]?.[count - 1] ?? 0);
  };
}

/** Realtime ticks through the whole JS pipeline (one flush per tick). */
function gateTicks(types: readonly { type: string; period: number }[]) {
  const store = new CandleStore(generateCandles({ count: 10_000, seed: 7 }));
  const engine = new IndicatorEngine(store, { requestFrame: () => {} });
  engine.setIndicators(
    types.map((t) => ({ type: t.type, config: { period: t.period } }))
  );
  engine.flush();
  const set = emptyUiIndicatorSet();
  applyIndicatorPayloads(
    set,
    engine.snapshotUpdates().map(packIndicatorUpdate)
  );
  let pending: readonly IndicatorUpdate[] = [];
  engine.subscribeResults((u) => {
    pending = u;
  });
  return () => {
    for (let t = 0; t < TICKS; t++) {
      const last = store.get(store.length - 1);
      if (!last) throw new Error('empty store');
      const drift = Math.sin(t) * last.close * 0.0005;
      if (t % 60 === 59) {
        const c = last.close + drift;
        store.append({
          time: last.time + 60_000,
          open: c,
          high: c,
          low: c,
          close: c,
          volume: 1,
        });
      } else {
        const close = last.close + drift;
        store.updateLast({
          ...last,
          close,
          high: Math.max(last.high, close),
          low: Math.min(last.low, close),
        });
      }
      engine.flush();
      applyIndicatorPayloads(set, pending.map(packIndicatorUpdate));
    }
    check(pending.length === types.length, 'incremental updates published');
    check(
      pending.every((u) => !u.removed && !u.full),
      'tail updates only'
    );
  };
}

/** UI frame: visible slice of `lines` outputs (+ optional band fill). */
function geometryFrames(module: IndicatorModule, withBand: boolean) {
  const store = new CandleStore(generateCandles({ count: 10_000, seed: 7 }));
  const result = module.indicator.calculate(
    store.columns,
    module.resolveConfig({ period: 20 })
  );
  const candles = createUiCandleSeries(store.columns);
  const outputs = result.outputs;
  const range = { startIndex: 0, endIndex: -1 };
  const out = { min: 0, max: 0 };
  return () => {
    const time: TimeScaleState = {
      width: 400,
      barSpacing: 400 / VISIBLE,
      rightOffset: 0,
      barCount: candles.length,
    };
    let points = 0;
    for (let f = 0; f < FRAMES; f++) {
      time.rightOffset = -(f % 500);
      getVisibleRange(time, 2, range);
      candleRangeMinMax(candles, range.startIndex, range.endIndex, out);
      const price = createPriceScale(out, 0, 600);
      if (withBand) {
        buildBandFill(
          outputs[0] as Float64Array,
          outputs[2] as Float64Array,
          result.length,
          range.startIndex,
          range.endIndex,
          time,
          price,
          pathSink
        );
      }
      for (const values of outputs) {
        points += buildLineGeometry(
          values,
          result.length,
          range.startIndex,
          range.endIndex,
          time,
          price,
          pathSink
        );
      }
    }
    check(points > FRAMES * VISIBLE, 'points emitted');
  };
}

export function runIndicatorBenchmarks(): void {
  const cases: [string, IndicatorModule, Readonly<Record<string, unknown>>][] =
    [
      ['SMA 20', smaModule as IndicatorModule, { period: 20 }],
      ['EMA 20', emaModule as IndicatorModule, { period: 20 }],
      ['WMA 20', wmaModule as IndicatorModule, { period: 20 }],
      ['BB 20 2', bollingerModule as IndicatorModule, { period: 20 }],
    ];
  for (const [name, module, raw] of cases) {
    bench(`full calculate ${name}, 10k bars`, 1, fullCalc(module, 10_000, raw));
    bench(
      `full calculate ${name}, 100k bars`,
      1,
      fullCalc(module, 100_000, raw)
    );
  }
  report('Indicator full calculation (per run = one calculate)');

  bench(
    '§36 tick: store + EMA20/EMA50 flush + pack/apply',
    TICKS,
    gateTicks([
      { type: 'ema', period: 20 },
      { type: 'ema', period: 50 },
    ]),
    { runs: 5, warmup: 1 }
  );
  bench(
    'tick: store + BB20 flush + pack/apply',
    TICKS,
    gateTicks([{ type: 'bollinger', period: 20 }]),
    { runs: 5, warmup: 1 }
  );
  bench(
    '§36 frame: one EMA line (×2 for EMA20+50), 200 visible',
    FRAMES,
    geometryFrames(emaModule as IndicatorModule, false)
  );
  bench(
    'frame: BB fill + 3 lines, 200 visible bars',
    FRAMES,
    geometryFrames(bollingerModule as IndicatorModule, true)
  );
  report('Indicator realtime path (10k bars; per op = one tick / frame)');
}
