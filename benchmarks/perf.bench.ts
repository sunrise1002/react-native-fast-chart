import { createLabelCache } from '../src/axes/LabelCache';
import { formatPrice } from '../src/axes/PriceFormat';
import { createPriceTicks, generatePriceTicks } from '../src/axes/PriceTicks';
import { createGlyphWidthTable, measureText } from '../src/axes/TextMetrics';
import {
  createTimeTicks,
  estimateBarInterval,
  generateTimeTicks,
  selectTimeInterval,
} from '../src/axes/TimeTicks';
import { createOffsetResolver } from '../src/axes/TimeZone';
import { CandleStore } from '../src/data/CandleStore';
import {
  createMinMaxPyramid,
  pyramidRangeMinMax,
  syncPyramid,
} from '../src/data/MinMaxPyramid';
import { createUiCandleSeries } from '../src/data/UiCandleSeries';
import {
  buildCandleGeometry,
  computeCandleMetrics,
  createCandleMetrics,
  type CandleGeometrySink,
} from '../src/render/candles/CandleGeometry';
import {
  conflateVisibleCandles,
  frameGroupSize,
} from '../src/render/conflation/ConflatedLayers';
import { createConflatedValues } from '../src/render/conflation/Conflation';
import {
  cachedCandleRange,
  createRenderCache,
} from '../src/render/conflation/RenderCache';
import {
  buildEnvelopeLine,
  conflateValues,
} from '../src/render/conflation/ValueConflation';
import {
  buildLineGeometry,
  type LinePathSink,
} from '../src/render/indicators/LineGeometry';
import { cachedPriceLabel } from '../src/render/skia/axisLabels';
import { generateCandles } from '../src/testing/fixtures/generateCandles';
import { candleRangeMinMax } from '../src/viewport/AutoScale';
import { createPriceScale } from '../src/viewport/PriceScale';
import type { TimeScaleState } from '../src/viewport/TimeScale';
import { getVisibleRange } from '../src/viewport/VisibleRange';
import { bench, check, consume, report } from './harness';

/*
 * P8 benchmarks: 100k bars fully zoomed out (400 dp plot, pr 3), before
 * (every bar) vs after (pyramid + pixel-bucket conflation), plus the
 * pyramid itself, sparse time ticks and cached axis labels.
 */

const N = 100_000;
const FRAMES = 200;
const WIDTH = 400;
const PR = 3;
const store = new CandleStore(generateCandles({ count: N, seed: 5 }));
const series = createUiCandleSeries(store.columns);
const zoomedOut: TimeScaleState = {
  width: WIDTH,
  barSpacing: WIDTH / N,
  rightOffset: 0,
  barCount: N,
};
const ema = Float64Array.from(store.columns.close.subarray(0, N));
for (let i = 1; i < N; i++) {
  ema[i] = (ema[i - 1] as number) * 0.9 + (ema[i] as number) * 0.1;
}

const sink: CandleGeometrySink & LinePathSink = {
  body: (_b, x, y, w, h) => consume(x + y + w + h),
  wick: (_b, x, y, w, h) => consume(x + y + w + h),
  moveTo: (x, y) => consume(x + y),
  lineTo: (x, y) => consume(x + y),
};

/** Full zoom-out candle frame drawing every bar (pre-P8 path). */
function candlesEveryBar(): void {
  const range = { startIndex: 0, endIndex: -1 };
  const out = { min: 0, max: 0 };
  const metrics = createCandleMetrics();
  let bars = 0;
  for (let f = 0; f < FRAMES; f++) {
    getVisibleRange(zoomedOut, 1, range);
    candleRangeMinMax(store.columns, range.startIndex, range.endIndex, out);
    const price = createPriceScale(out, 0, 600);
    computeCandleMetrics(zoomedOut.barSpacing, 0.8, 1, PR, metrics);
    bars = buildCandleGeometry(
      store.columns,
      range.startIndex,
      range.endIndex,
      zoomedOut,
      price,
      metrics,
      sink
    );
  }
  check(bars >= N, 'every bar drawn');
}

/** Same frame with the pyramid range + conflation (P8 path). */
function candlesConflated(): () => void {
  const cache = createRenderCache();
  const range = { startIndex: 0, endIndex: -1 };
  const out = { min: 0, max: 0 };
  const metrics = createCandleMetrics();
  return () => {
    let bars = 0;
    for (let f = 0; f < FRAMES; f++) {
      getVisibleRange(zoomedOut, 1, range);
      cachedCandleRange(cache, series, range.startIndex, range.endIndex, out);
      const price = createPriceScale(out, 0, 600);
      const group = frameGroupSize(zoomedOut.barSpacing, 2, 1, PR);
      const buckets = conflateVisibleCandles(
        cache,
        series,
        range.startIndex,
        range.endIndex,
        zoomedOut,
        group
      );
      computeCandleMetrics(buckets.scale.barSpacing, 0.8, 1, PR, metrics);
      bars = buildCandleGeometry(
        buckets,
        0,
        buckets.length - 1,
        buckets.scale,
        price,
        metrics,
        sink
      );
    }
    check(bars > 0 && bars <= (WIDTH * PR) / 2, 'bucket count ~ plot px');
  };
}

function lineEveryBar(): void {
  const price = createPriceScale({ min: 0, max: 1e6 }, 0, 600);
  let points = 0;
  for (let f = 0; f < FRAMES; f++) {
    points = buildLineGeometry(ema, N, 0, N - 1, zoomedOut, price, sink);
  }
  check(points >= N, 'every point drawn');
}

function lineEnvelope(): () => void {
  const pyramid = createMinMaxPyramid();
  syncPyramid(pyramid, ema, ema, 0, N, 0);
  const env = createConflatedValues();
  const scratch = { min: 0, max: 0 };
  const price = createPriceScale({ min: 0, max: 1e6 }, 0, 600);
  const group = frameGroupSize(zoomedOut.barSpacing, 2, 1, PR);
  return () => {
    let points = 0;
    for (let f = 0; f < FRAMES; f++) {
      conflateValues(ema, N, pyramid, 0, N - 1, zoomedOut, group, env, scratch);
      points = buildEnvelopeLine(env, price, sink);
    }
    check(points > 0 && points <= WIDTH * PR, 'envelope ≤ 2 points / bucket');
  };
}

function timeTicks(minBars: number): () => void {
  const barMs = estimateBarInterval(store.columns);
  const ticks = createTimeTicks();
  const resolver = createOffsetResolver('local');
  const k = selectTimeInterval(barMs, zoomedOut.barSpacing, 60);
  return () => {
    for (let f = 0; f < FRAMES; f++) {
      generateTimeTicks(store.columns, 0, N - 1, k, resolver, minBars, ticks);
    }
    check(ticks.count > 0, 'ticks generated');
  };
}

const GLYPHS = createGlyphWidthTable(new Array<number>(95).fill(6));

/** Price labels of a panning frame (ticks unchanged), uncached vs cached. */
function priceLabels(cached: boolean): () => void {
  const ticks = createPriceTicks();
  generatePriceTicks(64_000, 66_000, 600, 10, ticks);
  const cache = createLabelCache();
  return () => {
    let widest = 0;
    for (let f = 0; f < FRAMES * 10; f++) {
      for (let i = 0; i < ticks.count; i++) {
        const v = ticks.values[i] as number;
        if (cached) {
          cachedPriceLabel(cache, GLYPHS, v, ticks.decimals, ',');
          widest = Math.max(widest, cache.lastWidth);
        } else {
          const text = formatPrice(v, ticks.decimals, ',');
          widest = Math.max(widest, measureText(GLYPHS, text));
        }
      }
    }
    consume(widest);
    check(widest > 0, 'labels measured');
  };
}

export function runPerfBenchmarks(): void {
  const pyramid = createMinMaxPyramid();
  const { low, high } = store.columns;
  bench('pyramid build, 100k bars', 1, () =>
    syncPyramid(pyramid, low, high, 0, N, 0)
  );
  bench('pyramid sync of the last bar (tick)', 1000, () => {
    for (let i = 0; i < 1000; i++) {
      syncPyramid(pyramid, low, high, 0, N, N - 1);
    }
  });
  const out = { min: 0, max: 0 };
  bench('pyramid range query, 100k bars', 1000, () => {
    for (let i = 0; i < 1000; i++) {
      pyramidRangeMinMax(pyramid, low, high, 0, i, N - 1 - i, out);
      consume(out.max);
    }
  });
  bench('linear candleRangeMinMax, 100k bars', 1, () => {
    candleRangeMinMax(store.columns, 0, N - 1, out);
    consume(out.max);
  });
  bench('100k candles frame, every bar (before)', FRAMES, candlesEveryBar);
  bench('100k candles frame, conflated (after)', FRAMES, candlesConflated());
  bench('100k EMA line frame, every point (before)', FRAMES, lineEveryBar);
  bench(
    '100k EMA line frame, min/max envelope (after)',
    FRAMES,
    lineEnvelope()
  );
  bench('time ticks over 100k bars, linear scan', FRAMES, timeTicks(15.99));
  bench('time ticks over 100k bars, sparse', FRAMES, timeTicks(16));
  bench(
    'price labels frame, format + measure',
    FRAMES * 10,
    priceLabels(false)
  );
  bench('price labels frame, LabelCache', FRAMES * 10, priceLabels(true));
  report('P8 — 100k bars fully zoomed out, conflation, ticks, labels');
}
