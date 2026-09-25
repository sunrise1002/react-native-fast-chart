import type { IndicatorResult } from './Indicator';

/**
 * Result cache (spec Phase 7.4) keyed by indicator id, validated by the
 * dataset version (`CandleStore.version` / `resetVersion`) and the
 * indicator's config version. A lookup only hits when the entry was
 * computed from exactly the requested dataset and config.
 */
export interface IndicatorCacheEntry {
  readonly id: string;
  readonly configVersion: number;
  /** `CandleStore.version` the result reflects. */
  readonly datasetVersion: number;
  /** `CandleStore.resetVersion` the result was computed in. */
  readonly resetVersion: number;
  /** Time of bar 0 when computed (detects prepends / resets). */
  readonly firstTime: number;
  readonly result: IndicatorResult;
}

export class IndicatorCache {
  private readonly entries = new Map<string, IndicatorCacheEntry>();

  /** Entry regardless of versions (incremental updates start from it). */
  peek(id: string): IndicatorCacheEntry | undefined {
    return this.entries.get(id);
  }

  /** Result only when it matches both versions exactly. */
  get(
    id: string,
    datasetVersion: number,
    configVersion: number
  ): IndicatorResult | undefined {
    const entry = this.entries.get(id);
    return entry &&
      entry.datasetVersion === datasetVersion &&
      entry.configVersion === configVersion
      ? entry.result
      : undefined;
  }

  set(entry: IndicatorCacheEntry): void {
    this.entries.set(entry.id, entry);
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
