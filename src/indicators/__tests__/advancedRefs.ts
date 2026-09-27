import type { CandleColumns } from '../../data/CandleBuffer';
import type { PriceSource } from '../Indicator';
import { readSource } from '../IndicatorSeries';
import { refAtr, refRsi, refSeeded } from './indicatorTestUtils';

/*
 * Naive O(n·p) references of the P10 indicators, written straight from
 * the TradingView / Pine definitions and independent of the rolling
 * helpers (deques, ring sums) used by the kernels.
 */

const col = (a: Float64Array, c: CandleColumns) =>
  Array.from({ length: c.length }, (_, i) => a[c.offset + i] as number);
export const highs = (c: CandleColumns) => col(c.high, c);
export const lows = (c: CandleColumns) => col(c.low, c);
export const closes = (c: CandleColumns) => col(c.close, c);
export const volumes = (c: CandleColumns) => col(c.volume, c);
export const sourceOf = (c: CandleColumns, s: PriceSource) =>
  Array.from({ length: c.length }, (_, i) => readSource(c, i, s));

/** Window `[i − p + 1, i]` or `null` when incomplete / non-finite. */
function window(values: readonly number[], i: number, p: number) {
  if (i < p - 1) {
    return null;
  }
  const w = values.slice(i - p + 1, i + 1);
  return w.every(Number.isFinite) ? w : null;
}

export const rolling = (
  values: readonly number[],
  p: number,
  f: (w: number[], i: number) => number
) =>
  values.map((_, i) => {
    const w = window(values, i, p);
    return w === null ? NaN : f(w, i);
  });

export const refHighest = (v: readonly number[], p: number) =>
  rolling(v, p, (w) => Math.max(...w));
export const refLowest = (v: readonly number[], p: number) =>
  rolling(v, p, (w) => Math.min(...w));
export const refMean = (v: readonly number[], p: number) =>
  rolling(v, p, (w) => w.reduce((a, b) => a + b, 0) / p);

function stoch(x: readonly number[], hi: number[], lo: number[]) {
  return x.map((v, i) => {
    const range = (hi[i] as number) - (lo[i] as number);
    return range > 0 ? (100 * (v - (lo[i] as number))) / range : NaN;
  });
}

export function refStochastic(
  c: CandleColumns,
  kp: number,
  ks: number,
  ds: number
) {
  const raw = stoch(
    closes(c),
    refHighest(highs(c), kp),
    refLowest(lows(c), kp)
  );
  const k = refMean(raw, ks);
  return { k, d: refMean(k, ds) };
}

export function refStochRsi(
  c: CandleColumns,
  ks: number,
  ds: number,
  rp: number,
  sp: number
) {
  const rsi = refRsi(c, rp);
  const raw = stoch(rsi, refHighest(rsi, sp), refLowest(rsi, sp));
  const k = refMean(raw, ks);
  return { k, d: refMean(k, ds) };
}

export function refObv(c: CandleColumns) {
  const x = closes(c);
  const v = volumes(c);
  let total = 0;
  let prev = NaN;
  return x.map((close, i) => {
    const vol = v[i] as number;
    if (!Number.isFinite(close) || !Number.isFinite(vol)) {
      return NaN;
    }
    total += close > prev ? vol : close < prev ? -vol : 0;
    prev = close;
    return total;
  });
}

export function refMfi(c: CandleColumns, p: number) {
  const tp = sourceOf(c, 'hlc3');
  const v = volumes(c);
  const up = tp.map((x, i) =>
    i === 0 ? NaN : x > (tp[i - 1] as number) ? x * (v[i] as number) : 0 * x
  );
  const down = tp.map((x, i) =>
    i === 0 ? NaN : x < (tp[i - 1] as number) ? x * (v[i] as number) : 0 * x
  );
  const pos = rolling(up, p, (w) => w.reduce((a, b) => a + b, 0));
  const neg = rolling(down, p, (w) => w.reduce((a, b) => a + b, 0));
  return pos.map((g, i) => {
    const l = neg[i] as number;
    if (Number.isNaN(g) || Number.isNaN(l)) {
      return NaN;
    }
    return l === 0 ? 100 : g === 0 ? 0 : 100 - 100 / (1 + g / l);
  });
}

export function refCci(c: CandleColumns, p: number, s: PriceSource = 'hlc3') {
  const x = sourceOf(c, s);
  return rolling(x, p, (w, i) => {
    const mean = w.reduce((a, b) => a + b, 0) / p;
    const dev = w.reduce((a, b) => a + Math.abs(b - mean), 0) / p;
    return dev > 0 ? ((x[i] as number) - mean) / (0.015 * dev) : NaN;
  });
}

/** DMI on finite data (Pine `ta.dmi`, `fixnan` on a zero TR average). */
export function refAdx(c: CandleColumns, diLen: number, adxLen: number) {
  const h = highs(c);
  const l = lows(c);
  const x = closes(c);
  const tr = h.map((hi, i) => {
    if (i === 0) {
      return NaN;
    }
    const pc = x[i - 1] as number;
    return Math.max(
      hi - (l[i] as number),
      Math.abs(hi - pc),
      Math.abs((l[i] as number) - pc)
    );
  });
  const plusDm = h.map((hi, i) => {
    const up = hi - (h[i - 1] as number);
    const down = (l[i - 1] as number) - (l[i] as number);
    return i === 0 ? NaN : up > down && up > 0 ? up : 0;
  });
  const minusDm = h.map((hi, i) => {
    const up = hi - (h[i - 1] as number);
    const down = (l[i - 1] as number) - (l[i] as number);
    return i === 0 ? NaN : down > up && down > 0 ? down : 0;
  });
  const a = 1 / diLen;
  const trur = refSeeded(tr, diLen, a);
  const pAvg = refSeeded(plusDm, diLen, a);
  const mAvg = refSeeded(minusDm, diLen, a);
  let lastPlus = NaN;
  let lastMinus = NaN;
  const plus: number[] = [];
  const minus: number[] = [];
  trur.forEach((t, i) => {
    lastPlus = t === 0 ? lastPlus : (100 * (pAvg[i] as number)) / t;
    lastMinus = t === 0 ? lastMinus : (100 * (mAvg[i] as number)) / t;
    plus.push(lastPlus);
    minus.push(lastMinus);
  });
  const dx = plus.map((p, i) => {
    const m = minus[i] as number;
    const sum = p + m;
    return Math.abs(p - m) / (sum === 0 ? 1 : sum);
  });
  const adx = refSeeded(dx, adxLen, 1 / adxLen).map((v) => 100 * v);
  return { plus, minus, adx };
}

export function refDonchian(c: CandleColumns, p: number) {
  const upper = refHighest(highs(c), p);
  const lower = refLowest(lows(c), p);
  return {
    upper,
    lower,
    basis: upper.map((u, i) => (u + (lower[i] as number)) / 2),
  };
}

export function refKeltner(
  c: CandleColumns,
  p: number,
  mult: number,
  atrLen: number,
  s: PriceSource = 'close'
) {
  const basis = refSeeded(sourceOf(c, s), p, 2 / (p + 1));
  const atr = refAtr(c, atrLen);
  return {
    basis,
    upper: basis.map((b, i) => b + mult * (atr[i] as number)),
    lower: basis.map((b, i) => b - mult * (atr[i] as number)),
  };
}

/** Literal port of Pine's `supertrend()` reference (finite data). */
export function refSupertrend(
  c: CandleColumns,
  atrLen: number,
  factor: number
) {
  const atr = refAtr(c, atrLen);
  const hl2 = sourceOf(c, 'hl2');
  const x = closes(c);
  const up: number[] = [];
  const down: number[] = [];
  let pu = 0;
  let pl = 0;
  let prevSt = NaN;
  for (let i = 0; i < c.length; i++) {
    const a = atr[i] as number;
    let upper = (hl2[i] as number) + factor * a;
    let lower = (hl2[i] as number) - factor * a;
    const pc = x[i - 1] as number;
    lower = lower > pl || pc < pl ? lower : pl;
    upper = upper < pu || pc > pu ? upper : pu;
    let dir: number;
    if (i === 0 || Number.isNaN(atr[i - 1] as number)) {
      dir = 1;
    } else if (prevSt === pu) {
      dir = (x[i] as number) > upper ? -1 : 1;
    } else {
      dir = (x[i] as number) < lower ? 1 : -1;
    }
    const st = dir === -1 ? lower : upper;
    const valid = Number.isFinite(a);
    up.push(valid && dir < 0 ? st : NaN);
    down.push(valid && dir > 0 ? st : NaN);
    pu = Number.isFinite(upper) ? upper : 0;
    pl = Number.isFinite(lower) ? lower : 0;
    prevSt = st;
  }
  return { up, down };
}

/** Literal port of Pine's `ta.sar` reference implementation. */
export function refSar(
  c: CandleColumns,
  start: number,
  inc: number,
  max: number
) {
  const h = highs(c);
  const l = lows(c);
  const x = closes(c);
  const out: number[] = [];
  let result = NaN;
  let maxMin = NaN;
  let acc = NaN;
  let isBelow = false;
  for (let i = 0; i < c.length; i++) {
    const high = h[i] as number;
    const low = l[i] as number;
    let first = false;
    if (i === 1) {
      isBelow = (x[1] as number) > (x[0] as number);
      maxMin = isBelow ? high : low;
      result = isBelow ? (l[0] as number) : (h[0] as number);
      first = true;
      acc = start;
    }
    result = result + acc * (maxMin - result);
    if (isBelow ? result > low : result < high) {
      first = true;
      result = isBelow ? Math.max(high, maxMin) : Math.min(low, maxMin);
      isBelow = !isBelow;
      maxMin = isBelow ? high : low;
      acc = start;
    }
    if (!first && (isBelow ? high > maxMin : low < maxMin)) {
      maxMin = isBelow ? high : low;
      acc = Math.min(acc + inc, max);
    }
    if (i >= 1) {
      result = isBelow
        ? Math.min(
            result,
            l[i - 1] as number,
            i > 1 ? (l[i - 2] as number) : Infinity
          )
        : Math.max(
            result,
            h[i - 1] as number,
            i > 1 ? (h[i - 2] as number) : -Infinity
          );
    }
    out.push(result);
  }
  return out;
}

export function refIchimoku(
  c: CandleColumns,
  conv: number,
  base: number,
  spanB: number
) {
  const mid = (p: number) => {
    const hi = refHighest(highs(c), p);
    const lo = refLowest(lows(c), p);
    return hi.map((v, i) => (v + (lo[i] as number)) / 2);
  };
  const conversion = mid(conv);
  const baseLine = mid(base);
  return {
    conversion,
    base: baseLine,
    lagging: closes(c),
    spanA: conversion.map((v, i) => (v + (baseLine[i] as number)) / 2),
    spanB: mid(spanB),
  };
}

/**
 * Anchored VWAP with direct (unshifted) sums; `periodOf(time)` names the
 * anchor period of a bar.
 */
export function refVwap(
  c: CandleColumns,
  periodOf: (time: number) => number,
  mult: number,
  s: PriceSource = 'hlc3'
) {
  const x = sourceOf(c, s);
  const v = volumes(c);
  const vwap: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  let period = NaN;
  let sv = 0;
  let sxv = 0;
  let sxxv = 0;
  for (let i = 0; i < c.length; i++) {
    const t = c.time[c.offset + i] as number;
    const xi = x[i] as number;
    const vi = v[i] as number;
    if (![t, xi, vi].every(Number.isFinite)) {
      vwap.push(NaN);
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }
    if (periodOf(t) !== period) {
      period = periodOf(t);
      sv = 0;
      sxv = 0;
      sxxv = 0;
    }
    sv += vi;
    sxv += xi * vi;
    sxxv += xi * xi * vi;
    const m = sv > 0 ? sxv / sv : NaN;
    const sd = Math.sqrt(Math.max(0, sxxv / sv - m * m));
    vwap.push(m);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { vwap, upper, lower };
}
