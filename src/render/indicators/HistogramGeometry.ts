import type { HistogramColorMode } from '../../indicators/Indicator';
import { priceToY, type PriceScaleSnapshot } from '../../viewport/PriceScale';
import { indexToX, type TimeScaleState } from '../../viewport/TimeScale';
import type {
  CandleMetrics,
  CandleSeriesView,
} from '../candles/CandleGeometry';

/*
 * Generic histogram geometry (volume, MACD histogram; spec §17.4). Pure
 * and worklet-compatible: one rect per visible bar from the value to the
 * zero baseline, streamed into a sink with its color bucket so the
 * renderer batches each bucket into a single path (≤ 4 paths per
 * histogram, never one draw call per bar). Bars are as wide as candle
 * bodies and snapped to device pixels.
 */

export interface HistogramSink {
  /** Rect in dp (`x, y` = top-left); `bucket` per `HistogramColorMode`. */
  bar(bucket: number, x: number, y: number, w: number, h: number): void;
}

function clamp(value: number, lo: number, hi: number): number {
  'worklet';
  return value < lo ? lo : value > hi ? hi : value;
}

/** Number of color buckets used by a mode. */
export function histogramBucketCount(mode: HistogramColorMode): number {
  'worklet';
  return mode === 'trend' ? 4 : 2;
}

/**
 * Color bucket of bar `i` (see `HistogramColorMode`). `'trend'` compares
 * with the previous value (a missing previous value counts as not rising,
 * as in TradingView); `'candle'` needs the candles (bar `i` at
 * `offset + i`), a missing / non-finite candle is bearish.
 */
export function histogramBucket(
  mode: HistogramColorMode,
  values: ArrayLike<number>,
  i: number,
  candles: CandleSeriesView | null
): number {
  'worklet';
  const v = values[i] as number;
  if (mode === 'candle') {
    if (candles === null) {
      return 0;
    }
    const p = candles.offset + i;
    return (candles.close[p] as number) >= (candles.open[p] as number) ? 0 : 1;
  }
  if (mode === 'sign') {
    return v >= 0 ? 0 : 1;
  }
  const rising = i > 0 && (values[i - 1] as number) < v;
  if (v >= 0) {
    return rising ? 0 : 1;
  }
  return rising ? 3 : 2;
}

/**
 * Streams bars `[start, end]` (inclusive, clamped to `[0, length)`).
 * Values and the baseline are clamped to one pixel beyond the pane rect,
 * so off-scale bars stay bounded. Zero and non-finite values draw
 * nothing; a degenerate scale emits none. Returns the number of bars
 * emitted.
 */
export function buildHistogramGeometry(
  values: ArrayLike<number>,
  length: number,
  start: number,
  end: number,
  time: TimeScaleState,
  price: PriceScaleSnapshot,
  metrics: CandleMetrics,
  mode: HistogramColorMode,
  candles: CandleSeriesView | null,
  sink: HistogramSink
): number {
  'worklet';
  const pr = metrics.pixelRatio;
  const lo = (price.top - 1) * pr;
  const hi = (price.top + price.height + 1) * pr;
  const base = clamp(priceToY(price, 0) * pr, lo, hi);
  const k = price.height / (price.max - price.min);
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    !(k > 0 && k < Infinity) ||
    !(base - base === 0)
  ) {
    return 0;
  }
  const n = Math.min(length, values.length);
  const from = start > 0 ? Math.ceil(start) : 0;
  const to = end < n - 1 ? Math.floor(end) : n - 1;
  const widthPx = metrics.bodyWidthPx;
  const baseline = Math.round(base);
  let emitted = 0;
  for (let i = from; i <= to; i++) {
    const v = values[i] as number;
    const cx = indexToX(time, i) * pr;
    const y = clamp(priceToY(price, v) * pr, lo, hi);
    if (v === 0 || !(cx - cx === 0) || !(y - y === 0)) {
      continue;
    }
    const left = Math.round(cx - widthPx / 2);
    let top = Math.round(y < base ? y : baseline);
    let bottom = Math.round(y < base ? baseline : y);
    if (bottom - top < 1) {
      if (y < base) {
        top = bottom - 1;
      } else {
        bottom = top + 1;
      }
    }
    sink.bar(
      histogramBucket(mode, values, i, candles),
      left / pr,
      top / pr,
      widthPx / pr,
      (bottom - top) / pr
    );
    emitted++;
  }
  return emitted;
}
