/**
 * Real-Skia experiments (spec §17.2 path cache, §17.3 Picture): CanvasKit
 * (the WASM build `@shopify/react-native-skia` ships for web) drawing into
 * a CPU raster surface. `yarn bench:skia`. Absolute numbers are not device
 * numbers (WASM + CPU raster, no GPU); the ratios between strategies are
 * what decides which one the chart keeps (docs/PERFORMANCE.md).
 */
import CanvasKitInit from 'canvaskit-wasm';
import { CandleStore } from '../src/data/CandleStore';
import { createUiCandleSeries } from '../src/data/UiCandleSeries';
import {
  buildCandleGeometry,
  computeCandleMetrics,
  createCandleMetrics,
  type CandleGeometrySink,
  type CandleSeriesView,
} from '../src/render/candles/CandleGeometry';
import {
  conflateVisibleCandles,
  frameGroupSize,
} from '../src/render/conflation/ConflatedLayers';
import { createRenderCache } from '../src/render/conflation/RenderCache';
import { generateCandles } from '../src/testing/fixtures/generateCandles';
import { createPriceScale } from '../src/viewport/PriceScale';
import type { TimeScaleState } from '../src/viewport/TimeScale';
import { getVisibleRange } from '../src/viewport/VisibleRange';
import { bench, check, report } from './harness';

const CK = await CanvasKitInit();
const W = 1200;
const H = 900;
const PR = 3;
const FRAMES = 60;
const N = 100_000;
const surface = CK.MakeSurface(W, H);
check(surface !== null, 'raster surface');
const canvas = surface!.getCanvas();
const paint = new CK.Paint();
paint.setAntiAlias(false);
const store = new CandleStore(generateCandles({ count: N, seed: 5 }));
const series = createUiCandleSeries(store.columns);

const builders = [0, 1, 2, 3].map(() => new CK.PathBuilder());

/** Candle geometry of `[start, end]` into the four builders. */
function record(
  data: CandleSeriesView,
  start: number,
  end: number,
  time: TimeScaleState
): number {
  const out = { min: Infinity, max: -Infinity };
  for (let i = start; i <= end; i++) {
    out.min = Math.min(out.min, data.low[i] as number);
    out.max = Math.max(out.max, data.high[i] as number);
  }
  const price = createPriceScale(out, 0, H / PR);
  const metrics = computeCandleMetrics(
    time.barSpacing,
    0.8,
    1,
    PR,
    createCandleMetrics()
  );
  const rect = CK.XYWHRect(0, 0, 0, 0);
  const sink: CandleGeometrySink = {
    body: (bull, x, y, w, h) => {
      rect.set([x, y, x + w, y + h]);
      builders[bull ? 0 : 1]!.addRect(rect);
    },
    wick: (bull, x, y, w, h) => {
      rect.set([x, y, x + w, y + h]);
      builders[bull ? 2 : 3]!.addRect(rect);
    },
  };
  return buildCandleGeometry(data, start, end, time, price, metrics, sink);
}

function scale(barSpacing: number, rightOffset: number): TimeScaleState {
  return { width: W / PR, barSpacing, rightOffset, barCount: N };
}

/** Dynamic: rebuild the paths from the data every frame (current design). */
function dynamic(barSpacing: number): () => void {
  const range = { startIndex: 0, endIndex: -1 };
  return () => {
    for (let f = 0; f < FRAMES; f++) {
      const time = scale(barSpacing, -f * 0.37);
      getVisibleRange(time, 1, range);
      record(store.columns, range.startIndex, range.endIndex, time);
      canvas.clear(CK.BLACK);
      for (const b of builders) {
        const path = b.detach();
        canvas.drawPath(path, paint);
        path.delete();
      }
    }
    surface!.flush();
  };
}

/** Cached paths: build once, pan by translating (pure pans only). */
function cachedPaths(barSpacing: number): () => void {
  const time = scale(barSpacing, 0);
  const range = getVisibleRange(time, 64);
  record(store.columns, range.startIndex, range.endIndex, time);
  const paths = builders.map((b) => b.detach());
  return () => {
    for (let f = 0; f < FRAMES; f++) {
      canvas.clear(CK.BLACK);
      canvas.save();
      canvas.translate(f * 0.37 * barSpacing * PR, 0);
      for (const p of paths) {
        canvas.drawPath(p, paint);
      }
      canvas.restore();
    }
    surface!.flush();
  };
}

/** Picture: record once, replay translated (pure pans only). */
function picture(barSpacing: number): () => void {
  const time = scale(barSpacing, 0);
  const range = getVisibleRange(time, 64);
  record(store.columns, range.startIndex, range.endIndex, time);
  const recorder = new CK.PictureRecorder();
  const rc = recorder.beginRecording(CK.LTRBRect(-W, 0, 2 * W, H));
  for (const b of builders) {
    const path = b.detach();
    rc.drawPath(path, paint);
    path.delete();
  }
  const pic = recorder.finishRecordingAsPicture();
  return () => {
    for (let f = 0; f < FRAMES; f++) {
      canvas.clear(CK.BLACK);
      canvas.save();
      canvas.translate(f * 0.37 * barSpacing * PR, 0);
      canvas.drawPicture(pic);
      canvas.restore();
    }
    surface!.flush();
  };
}

/** Full zoom-out on 100k bars: every bar vs pixel-bucket conflation. */
function zoomedOut(conflate: boolean): () => void {
  const time = scale(W / PR / N, 0);
  const cache = createRenderCache();
  return () => {
    for (let f = 0; f < FRAMES / 6; f++) {
      if (conflate) {
        const group = frameGroupSize(time.barSpacing, 2, 1, PR);
        const b = conflateVisibleCandles(cache, series, 0, N - 1, time, group);
        record(b, 0, b.length - 1, b.scale);
      } else {
        record(store.columns, 0, N - 1, time);
      }
      canvas.clear(CK.BLACK);
      for (const b of builders) {
        const path = b.detach();
        canvas.drawPath(path, paint);
        path.delete();
      }
    }
    surface!.flush();
  };
}

console.log(`Node ${process.version}, CanvasKit raster ${W}×${H}`);
for (const spacing of [8, 0.5]) {
  bench(
    `candles ${spacing} dp: rebuild paths per frame`,
    FRAMES,
    dynamic(spacing)
  );
  bench(
    `candles ${spacing} dp: cached paths + translate`,
    FRAMES,
    cachedPaths(spacing)
  );
  bench(
    `candles ${spacing} dp: Picture replay + translate`,
    FRAMES,
    picture(spacing)
  );
}
bench('100k bars zoomed out: every bar', FRAMES / 6, zoomedOut(false), {
  runs: 3,
  warmup: 1,
});
bench('100k bars zoomed out: conflated', FRAMES / 6, zoomedOut(true));
report('Skia strategies (CanvasKit, CPU raster; per op = one frame)');
