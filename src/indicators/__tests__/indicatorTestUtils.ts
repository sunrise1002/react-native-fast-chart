import type { CandleColumns } from '../../data/CandleBuffer';
import type { PriceSource, SeriesSource } from '../Indicator';
import { readSource } from '../IndicatorSeries';

export interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Raw columns (no validation, NaN allowed) with an optional physical offset. */
export function columnsOf(
  bars: readonly (Bar | number)[],
  offset = 0
): CandleColumns {
  const n = bars.length;
  const make = () => new Float64Array(n + offset + 3).fill(-999);
  const c = {
    time: make(),
    open: make(),
    high: make(),
    low: make(),
    close: make(),
    volume: make(),
    offset,
    length: n,
  };
  bars.forEach((b, i) => {
    const bar =
      typeof b === 'number' ? { open: b, high: b, low: b, close: b } : b;
    const p = offset + i;
    c.time[p] = 1000 * (i + 1);
    c.open[p] = bar.open;
    c.high[p] = bar.high;
    c.low[p] = bar.low;
    c.close[p] = bar.close;
    c.volume[p] = 1;
  });
  return c;
}

/** Prefix view of the first `length` bars (same arrays). */
export function prefix(columns: CandleColumns, length: number): CandleColumns {
  return { ...columns, length };
}

function src(c: CandleColumns, i: number, s: SeriesSource): number {
  return readSource(c, i, s);
}

/* Naive O(n·p) references (independent of the rolling implementations). */

export function refSma(c: CandleColumns, p: number, s: SeriesSource = 'close') {
  const out: number[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i < p - 1) {
      out.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - p + 1; j <= i; j++) {
      sum += src(c, j, s);
    }
    out.push(sum / p);
  }
  return out;
}

export function refWma(c: CandleColumns, p: number, s: PriceSource = 'close') {
  const out: number[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i < p - 1) {
      out.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < p; j++) {
      sum += (p - j) * src(c, i - j, s);
    }
    out.push(sum / ((p * (p + 1)) / 2));
  }
  return out;
}

export function refEma(c: CandleColumns, p: number, s: PriceSource = 'close') {
  const out: number[] = [];
  const alpha = 2 / (p + 1);
  let ema = NaN;
  for (let i = 0; i < c.length; i++) {
    if (i < p - 1) {
      out.push(NaN);
    } else if (i === p - 1) {
      ema = refSma(prefix(c, p), p, s)[p - 1] as number;
      out.push(ema);
    } else {
      ema = src(c, i, s) * alpha + ema * (1 - alpha);
      out.push(ema);
    }
  }
  return out;
}

export function refBollinger(
  c: CandleColumns,
  p: number,
  k: number,
  s: PriceSource = 'close'
) {
  const mid = refSma(c, p, s);
  const upper: number[] = [];
  const lower: number[] = [];
  mid.forEach((m, i) => {
    if (Number.isNaN(m)) {
      upper.push(NaN);
      lower.push(NaN);
      return;
    }
    let ss = 0;
    for (let j = i - p + 1; j <= i; j++) {
      ss += (src(c, j, s) - m) ** 2;
    }
    const sd = Math.sqrt(ss / p);
    upper.push(m + k * sd);
    lower.push(m - k * sd);
  });
  return { upper, middle: mid, lower };
}

/** Asserts `actual[0..n)` matches `expected` (NaN ↔ NaN) within rel. `tol`. */
export function expectSeries(
  actual: Float64Array,
  expected: readonly number[],
  tol = 1e-9
): void {
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i] as number;
    const a = actual[i] as number;
    if (Number.isNaN(e)) {
      if (!Number.isNaN(a)) {
        throw new Error(`index ${i}: expected NaN, got ${a}`);
      }
      continue;
    }
    const scale = Math.max(1, Math.abs(e));
    if (!(Math.abs(a - e) <= tol * scale)) {
      throw new Error(`index ${i}: expected ${e}, got ${a}`);
    }
  }
}

/** Seeded EMA / RMA over an arbitrary series (leading NaNs skipped). */
export function refSeeded(values: readonly number[], p: number, alpha: number) {
  const out: number[] = [];
  const seed: number[] = [];
  let avg = NaN;
  for (const x of values) {
    if (!Number.isFinite(x)) {
      out.push(NaN);
      continue;
    }
    if (seed.length < p) {
      seed.push(x);
      avg = seed.length === p ? seed.reduce((a, b) => a + b, 0) / p : NaN;
      out.push(avg);
      continue;
    }
    avg = alpha * x + (1 - alpha) * avg;
    out.push(avg);
  }
  return out;
}

export function refRsi(c: CandleColumns, p: number) {
  const closes = Array.from({ length: c.length }, (_, i) => src(c, i, 'close'));
  const gains = closes.map((x, i) =>
    i === 0 ? NaN : Math.max(0, x - (closes[i - 1] as number))
  );
  const losses = closes.map((x, i) =>
    i === 0 ? NaN : Math.max(0, (closes[i - 1] as number) - x)
  );
  const g = refSeeded(gains, p, 1 / p);
  const l = refSeeded(losses, p, 1 / p);
  return g.map((gain, i) => {
    const loss = l[i] as number;
    if (Number.isNaN(gain)) {
      return NaN;
    }
    return loss === 0 ? 100 : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss);
  });
}

export function refMacd(
  c: CandleColumns,
  fast: number,
  slow: number,
  sig: number
) {
  const closes = Array.from({ length: c.length }, (_, i) => src(c, i, 'close'));
  const f = refSeeded(closes, fast, 2 / (fast + 1));
  const s = refSeeded(closes, slow, 2 / (slow + 1));
  const macd = f.map((v, i) => v - (s[i] as number));
  const signal = refSeeded(macd, sig, 2 / (sig + 1));
  const histogram = macd.map((v, i) => v - (signal[i] as number));
  return { macd, signal, histogram };
}

export function refAtr(c: CandleColumns, p: number) {
  const tr: number[] = [];
  for (let i = 0; i < c.length; i++) {
    const h = c.high[c.offset + i] as number;
    const l = c.low[c.offset + i] as number;
    if (i === 0) {
      tr.push(h - l);
      continue;
    }
    const pc = c.close[c.offset + i - 1] as number;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return refSeeded(tr, p, 1 / p);
}
