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
import { formatPrice } from '../src/axes/PriceFormat';
import { createPriceTicks, generatePriceTicks } from '../src/axes/PriceTicks';
import { formatTimeTick } from '../src/axes/TimeFormat';
import {
  createTimeTicks,
  estimateBarInterval,
  generateTimeTicks,
  selectTimeInterval,
} from '../src/axes/TimeTicks';
import { createOffsetResolver } from '../src/axes/TimeZone';
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

/**
 * One axes frame as `useAxesLayer` runs it: price ticks + labels, time
 * ticks + labels (local zone), grid lines. Fresh tick buffers per frame,
 * like the UI mapper.
 */
function axesFrames(barSpacing: number): () => void {
  const columns = store.columns;
  const barMs = estimateBarInterval(columns);
  return () => {
    const time: TimeScaleState = {
      width: 400,
      barSpacing,
      rightOffset: 0,
      barCount: N,
    };
    const range = { startIndex: 0, endIndex: -1 };
    let labels = 0;
    for (let f = 0; f < FRAMES; f++) {
      time.rightOffset = -((f * 7) % (N / 2));
      const price = createPriceScale({ min: 100, max: 200 }, 0, 600);
      const priceTicks = createPriceTicks();
      generatePriceTicks(price.min, price.max, price.height, 10, priceTicks);
      for (let i = 0; i < priceTicks.count; i++) {
        labels += formatPrice(
          priceTicks.values[i] as number,
          priceTicks.decimals
        ).length;
      }
      const timeTicks = createTimeTicks();
      const k = selectTimeInterval(barMs, barSpacing, 60);
      getVisibleRange(time, Math.ceil(60 / barSpacing) + 1, range);
      generateTimeTicks(
        columns,
        range.startIndex,
        range.endIndex,
        k,
        createOffsetResolver('local'),
        60 / barSpacing,
        timeTicks
      );
      for (let i = 0; i < timeTicks.count; i++) {
        labels += formatTimeTick(
          timeTicks.payload[i] as number,
          timeTicks.weights[i] as number,
          false
        ).length;
      }
      buildGridGeometry(
        time,
        price,
        priceTicks,
        timeTicks,
        { ...DEFAULT_GRID_OPTIONS, pixelRatio: 3 },
        sink
      );
    }
    check(labels > 0, 'labels formatted');
  };
}

export function runRenderBenchmarks(): void {
  bench('candle geometry frame, 52 bars (8 dp)', FRAMES, candleFrames(8));
  bench('candle geometry frame, 802 bars (0.5 dp)', FRAMES, candleFrames(0.5));
  bench('axes frame (ticks + labels + grid), 8 dp', FRAMES, axesFrames(8));
  bench('axes frame (ticks + labels + grid), 0.5 dp', FRAMES, axesFrames(0.5));
  report('Render geometry (100k bars, sink = addRect stand-in)');
}
