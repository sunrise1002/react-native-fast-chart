import type { CandleColumns } from '../data/CandleBuffer';
import type { IndicatorResult } from './Indicator';
import type { IndicatorCache } from './IndicatorCache';
import type { IndicatorModule } from './IndicatorRegistry';
import type { PendingIndicatorWork } from './IndicatorScheduler';

/** What changed for one indicator in a flush. */
export type IndicatorUpdate =
  | {
      readonly id: string;
      readonly removed: false;
      /** `true` = recalculated from scratch (replace all values). */
      readonly full: boolean;
      /** First bar whose values changed. */
      readonly from: number;
      readonly result: IndicatorResult;
      readonly resetVersion: number;
      readonly firstTime: number;
    }
  | { readonly id: string; readonly removed: true };

/** Candle input of one flush plus the versions identifying it. */
export interface IndicatorDataset {
  readonly columns: CandleColumns;
  readonly version: number;
  readonly resetVersion: number;
  /** Time of bar 0 (`NaN` when empty). */
  readonly firstTime: number;
}

/** One active indicator to bring up to date. */
export interface IndicatorTask {
  readonly id: string;
  readonly module: IndicatorModule;
  readonly config: unknown;
  readonly configVersion: number;
  /** Forces a full calculation (just added / config changed). */
  dirty: boolean;
}

/**
 * Computation backend seam (spec Phase 7.5). The v1 backend below runs
 * synchronously on the JS thread; a worker / native backend would
 * implement the same contract and deliver `updates` asynchronously.
 * Returns the first error thrown by an indicator (others still run).
 */
export interface IndicatorBackend {
  compute(
    dataset: IndicatorDataset,
    tasks: Iterable<IndicatorTask>,
    work: Readonly<PendingIndicatorWork>,
    cache: IndicatorCache,
    updates: IndicatorUpdate[]
  ): unknown;
}

/**
 * Chooses per task between "up to date", incremental `update` (append /
 * updateLast / tail patch since the cached version) and a full
 * `calculate` (dirty, reset, prepend, config change, unknown history).
 */
export const synchronousIndicatorBackend: IndicatorBackend = {
  compute(dataset, tasks, work, cache, updates) {
    const { columns, version, resetVersion, firstTime } = dataset;
    let failure: unknown;
    for (const task of tasks) {
      const { id } = task;
      const cached = cache.peek(id);
      const full =
        task.dirty ||
        work.full ||
        cached === undefined ||
        cached.configVersion !== task.configVersion ||
        cached.resetVersion !== resetVersion ||
        !Object.is(cached.firstTime, firstTime) ||
        (cached.datasetVersion !== version && work.fromIndex === Infinity);
      if (!full && cached.datasetVersion === version) {
        continue;
      }
      const { indicator } = task.module;
      try {
        const result =
          full || !indicator.update
            ? indicator.calculate(columns, task.config)
            : indicator.update(
                cached.result,
                columns,
                work.fromIndex,
                task.config
              );
        task.dirty = false;
        cache.set({
          id,
          configVersion: task.configVersion,
          datasetVersion: version,
          resetVersion,
          firstTime,
          result,
        });
        const recalculated = full || result !== cached.result;
        updates.push({
          id,
          removed: false,
          full: recalculated,
          from: recalculated ? 0 : result.changedFrom,
          result,
          resetVersion,
          firstTime,
        });
      } catch (error) {
        // Isolate faulty (custom) indicators: drop the stale result.
        cache.delete(id);
        updates.push({ id, removed: true });
        failure ??= error;
      }
    }
    return failure;
  },
};

/** Full updates for every cached indicator of `ids` (initial UI sync). */
export function snapshotUpdates(
  cache: IndicatorCache,
  ids: readonly string[]
): IndicatorUpdate[] {
  const out: IndicatorUpdate[] = [];
  for (const id of ids) {
    const cached = cache.peek(id);
    if (cached) {
      out.push({
        id,
        removed: false,
        full: true,
        from: 0,
        result: cached.result,
        resetVersion: cached.resetVersion,
        firstTime: cached.firstTime,
      });
    }
  }
  return out;
}
