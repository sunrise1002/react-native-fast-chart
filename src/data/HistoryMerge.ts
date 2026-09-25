import type { Candle } from './Candle';
import type { CandleStore } from './CandleStore';
import { normalizeCandles, type CandleIssue } from './CandleValidation';

/**
 * How bars present both in the store and in the incoming batch are resolved.
 *
 * - `'history'` (default, for REST history pages and initial loads): the
 *   incoming bar wins for **closed** bars (history is authoritative). The
 *   store's **last** bar is the live bar being built by realtime updates, so
 *   it is combined instead: `open` from history (realtime may have joined
 *   mid-bar), `high = max`, `low = min`, `close` from realtime (fresher),
 *   `volume = max` (both are partial sums of the same bar).
 * - `'replace'`: incoming always wins (reconnect snapshots, corrections).
 * - `'keep'`: existing always wins; only missing bars are added.
 */
export type MergeConflictPolicy = 'history' | 'replace' | 'keep';

export interface MergeOptions {
  policy?: MergeConflictPolicy;
}

export interface MergeResult {
  /** Bars inserted before the previous first bar. */
  prepended: number;
  /** Bars inserted after the previous last bar. */
  appended: number;
  /** Bars inserted between existing bars (gap fills). */
  inserted: number;
  /** Existing bars whose values were overwritten. */
  replaced: number;
  /** Incoming bars dropped by normalization (invalid / superseded). */
  issues: CandleIssue[];
}

function sameValues(a: Candle, b: Candle): boolean {
  return (
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}

function combineLive(live: Candle, history: Candle): Candle {
  const open = history.open;
  const close = live.close;
  return {
    time: live.time,
    open,
    high: Math.max(live.high, history.high, open, close),
    low: Math.min(live.low, history.low, open, close),
    close,
    volume: Math.max(live.volume, history.volume),
  };
}

function resolve(
  existing: Candle,
  incoming: Candle,
  isLive: boolean,
  policy: MergeConflictPolicy
): Candle {
  if (policy === 'keep') {
    return existing;
  }
  if (policy === 'history' && isLive) {
    return combineLive(existing, incoming);
  }
  return incoming;
}

/**
 * Merges a batch of bars (any order, possibly overlapping, duplicated or
 * partly invalid) into the store (spec Phase 1.2, §9.1).
 *
 * Handles history/realtime races: a history page that arrives after realtime
 * already created newer bars is merged around them instead of wiping them.
 * Emits at most three store events, in this order: `patch` (overlap),
 * `append` (newer bars), `prepend` (older bars). Cost: O(k log k) for the
 * batch + O(overlap + bars after the overlap) for in-place edits; a pure
 * history prepend is amortized O(k).
 */
export function mergeCandles(
  store: CandleStore,
  input: readonly unknown[],
  options: MergeOptions = {}
): MergeResult {
  const policy = options.policy ?? 'history';
  const { candles, issues } = normalizeCandles(input);
  const result: MergeResult = {
    prepended: 0,
    appended: 0,
    inserted: 0,
    replaced: 0,
    issues,
  };
  if (candles.length === 0) {
    return result;
  }
  if (store.length === 0) {
    store.setData(candles);
    result.appended = candles.length;
    return result;
  }

  const firstTime = store.firstTime;
  const lastTime = store.lastTime;
  // Incoming is sorted: split into older | overlap | newer.
  let a = 0;
  while (a < candles.length && (candles[a] as Candle).time < firstTime) {
    a++;
  }
  let b = a;
  while (b < candles.length && (candles[b] as Candle).time <= lastTime) {
    b++;
  }

  if (b > a) {
    mergeOverlap(store, candles, a, b, policy, result);
  }
  if (b < candles.length) {
    store.appendMany(candles.slice(b));
    result.appended = candles.length - b;
  }
  if (a > 0) {
    store.prepend(candles.slice(0, a));
    result.prepended = a;
  }
  return result;
}

/** Rebuilds the overlapped store region and writes it with one splice. */
function mergeOverlap(
  store: CandleStore,
  candles: readonly Candle[],
  a: number,
  b: number,
  policy: MergeConflictPolicy,
  result: MergeResult
): void {
  const from = store.lowerBound((candles[a] as Candle).time);
  const to = store.upperBound((candles[b - 1] as Candle).time);
  const liveIndex = store.length - 1;
  const merged: Candle[] = [];
  let firstChanged = -1;
  let i = from;
  for (let j = a; j < b; j++) {
    const bar = candles[j] as Candle;
    // Existing bars between incoming ones are kept as they are.
    while (i < to && store.timeAt(i) < bar.time) {
      merged.push(store.get(i) as Candle);
      i++;
    }
    if (i < to && store.timeAt(i) === bar.time) {
      const existing = store.get(i) as Candle;
      const next = resolve(existing, bar, i === liveIndex, policy);
      i++;
      if (!sameValues(next, existing)) {
        result.replaced++;
        if (firstChanged < 0) {
          firstChanged = merged.length;
        }
      }
      merged.push(next);
    } else {
      result.inserted++;
      if (firstChanged < 0) {
        firstChanged = merged.length;
      }
      merged.push(bar);
    }
  }
  // `to` is the upper bound of the last incoming time, so i === to here.
  if (firstChanged < 0) {
    return;
  }
  // Skip the unchanged prefix so the patch starts at the first real change.
  store.splice(
    from + firstChanged,
    to - from - firstChanged,
    merged.slice(firstChanged)
  );
}
