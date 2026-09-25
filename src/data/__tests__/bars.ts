import type { Candle } from '../Candle';
import type { CandleStore } from '../CandleStore';

export const T0 = Date.UTC(2024, 0, 1);
export const MIN = 60_000;

/** Valid bar at `T0 + i` minutes with close `c` (defaults to 100 + i). */
export function bar(i: number, c = 100 + i, volume = 1): Candle {
  return {
    time: T0 + i * MIN,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume,
  };
}

export function bars(from: number, to: number): Candle[] {
  const out: Candle[] = [];
  for (let i = from; i <= to; i++) {
    out.push(bar(i));
  }
  return out;
}

/** Minute indices (relative to T0) of every stored bar. */
export function minutes(store: CandleStore): number[] {
  return store.getRange(0, store.length).map((c) => (c.time - T0) / MIN);
}
