import { CandleStore } from '../src/data/CandleStore';
import {
  buildCandleGeometry,
  computeCandleMetrics,
  createCandleMetrics,
  type CandleGeometrySink,
} from '../src/render/candles/CandleGeometry';
import {
  buildGridGeometry,
  DEFAULT_GRID_OPTIONS,
  type GridSink,
} from '../src/render/grid/GridGeometry';
import { generateCandles } from '../src/testing/fixtures/generateCandles';
import { candleRangeMinMax } from '../src/viewport/AutoScale';
import { createPriceScale } from '../src/viewport/PriceScale';
import type { TimeScaleState } from '../src/viewport/TimeScale';
import { getVisibleRange } from '../src/viewport/VisibleRange';
import { bench, check, consume, report } from './harness';

const N = 100_000;
const FRAMES = 2_000;
const store = new CandleStore(generateCandles({ count: N, seed: 5 }));

/** Sink summing coordinates: stands in for `SkPathBuilder.addRect`. */
const sink: CandleGeometrySink & GridSink = {
  body: (_b, x, y, w, h) => consume(x + y + w + h),
  wick: (_b, x, y, w, h) => consume(x + y + w + h),
  line: (_h, x, y, w, h) => consume(x + y + w + h),
};

/** One frame of candle geometry at `barSpacing` on a 400 dp plot, pr 3. */
function candleFrames(barSpacing: number): () => void {
  const range = { startIndex: 0, endIndex: -1 };
  const metrics = createCandleMetrics();
  const out = { min: 0, max: 0 };
  return () => {
    const time: TimeScaleState = {
      width: 400,
      barSpacing,
      rightOffset: 0,
      barCount: N,
    };
    let bars = 0;
    for (let f = 0; f < FRAMES; f++) {
      time.rightOffset = -((f * 7) % (N / 2));
      getVisibleRange(time, 1, range);
      candleRangeMinMax(store.columns, range.startIndex, range.endIndex, out);
      const price = createPriceScale(out, 0, 600);
      computeCandleMetrics(barSpacing, 0.8, 1, 3, metrics);
      bars = buildCandleGeometry(
        store.columns,
        range.startIndex,
        range.endIndex,
        time,
        price,
        metrics,
        sink
      );
    }
    check(bars > 0, 'bars drawn');
  };
}

export function runRenderBenchmarks(): void {
  bench('candle geometry frame, 52 bars (8 dp)', FRAMES, candleFrames(8));
  bench('candle geometry frame, 802 bars (0.5 dp)', FRAMES, candleFrames(0.5));
  bench('grid geometry frame', FRAMES, () => {
    const time: TimeScaleState = {
      width: 400,
      barSpacing: 8,
      rightOffset: 0,
      barCount: N,
    };
    const price = createPriceScale({ min: 100, max: 200 }, 0, 600);
    const options = { ...DEFAULT_GRID_OPTIONS, pixelRatio: 3 };
    for (let f = 0; f < FRAMES; f++) {
      time.rightOffset = -f;
      consume(buildGridGeometry(time, price, options, sink));
    }
  });
  report('Render geometry (100k bars, sink = addRect stand-in)');
}
