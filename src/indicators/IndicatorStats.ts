import type { IndicatorUpdate } from './IndicatorCompute';

/** Compute counters of one indicator (or of all, in the totals). */
export interface IndicatorComputeCounts {
  /** Full `calculate` runs (add, config change, reset, prepend). */
  full: number;
  /** Incremental tail updates (append / updateLast / tail patch). */
  incremental: number;
}

/** Full vs incremental computation counts (`indicators.getComputeStats()`). */
export interface IndicatorComputeStats extends IndicatorComputeCounts {
  /** Flushes that computed at least one indicator. */
  flushes: number;
  /** Per indicator id (ids removed since the last reset are kept). */
  byId: Readonly<Record<string, IndicatorComputeCounts>>;
}

/**
 * Instrumentation proving spec §33.6 ("no full recalculation per tick"):
 * counts full vs incremental computations per flush. Integer increments
 * only — cheap enough to stay on in production.
 */
export class IndicatorStatsCollector {
  private full = 0;
  private incremental = 0;
  private flushes = 0;
  private byId = new Map<string, IndicatorComputeCounts>();

  record(updates: readonly IndicatorUpdate[]): void {
    let computed = false;
    for (const update of updates) {
      if (update.removed) {
        continue;
      }
      computed = true;
      let counts = this.byId.get(update.id);
      if (!counts) {
        counts = { full: 0, incremental: 0 };
        this.byId.set(update.id, counts);
      }
      if (update.full) {
        counts.full++;
        this.full++;
      } else {
        counts.incremental++;
        this.incremental++;
      }
    }
    if (computed) {
      this.flushes++;
    }
  }

  snapshot(): IndicatorComputeStats {
    const byId: Record<string, IndicatorComputeCounts> = {};
    for (const [id, counts] of this.byId) {
      byId[id] = { ...counts };
    }
    return {
      full: this.full,
      incremental: this.incremental,
      flushes: this.flushes,
      byId,
    };
  }

  reset(): void {
    this.full = 0;
    this.incremental = 0;
    this.flushes = 0;
    this.byId = new Map();
  }
}
