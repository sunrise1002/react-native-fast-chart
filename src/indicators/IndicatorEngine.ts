import type { CandleStore } from '../data/CandleStore';
import {
  NOOP_PROFILER,
  type RenderProfiler,
} from '../performance/RenderProfiler';
import { ListenerSet } from '../utils/ListenerSet';
import { createIndicatorRegistry } from './builtins';
import type { IndicatorInput, IndicatorResult } from './Indicator';
import { IndicatorCache } from './IndicatorCache';
import {
  snapshotUpdates,
  synchronousIndicatorBackend,
  type IndicatorBackend,
  type IndicatorTask,
  type IndicatorUpdate,
} from './IndicatorCompute';
import {
  createIndicatorEntry,
  sameConfig,
  type IndicatorEntry,
} from './IndicatorDefinitions';
import type { IndicatorModule, IndicatorRegistry } from './IndicatorRegistry';
import {
  IndicatorStatsCollector,
  type IndicatorComputeStats,
} from './IndicatorStats';
import {
  IndicatorScheduler,
  type PendingIndicatorWork,
  type RequestFrame,
} from './IndicatorScheduler';

export type { IndicatorUpdate } from './IndicatorCompute';

export type IndicatorUpdateListener = (
  updates: readonly IndicatorUpdate[]
) => void;

export interface IndicatorEngineOptions {
  registry?: IndicatorRegistry;
  requestFrame?: RequestFrame;
  /** Profiler of the `indicator` metrics channel (read per flush). */
  getProfiler?: () => RenderProfiler;
  /** Computation backend (default: synchronous, JS thread). */
  backend?: IndicatorBackend;
}

interface ActiveIndicator extends IndicatorTask {
  entry: IndicatorEntry;
  config: unknown;
  configVersion: number;
}

/** Patch accepted by `update` (type changes replace the indicator). */
export type IndicatorPatch = Partial<Omit<IndicatorInput, 'id'>>;

/**
 * Runs the active indicators of one chart against its `CandleStore`
 * (pure TS, no React / Skia). Store mutations are coalesced by the
 * scheduler and applied incrementally when possible (append / updateLast
 * → tail update; reset / prepend / config change → full recalculation).
 * Results are published to `subscribeResults` listeners (UI sync);
 * definition changes to `subscribeEntries` listeners (React).
 */
export class IndicatorEngine {
  readonly registry: IndicatorRegistry;
  private readonly cache = new IndicatorCache();
  private readonly scheduler: IndicatorScheduler;
  private readonly active = new Map<string, ActiveIndicator>();
  private order: string[] = [];
  private removed: string[] = [];
  private entries: readonly IndicatorEntry[] = [];
  private readonly entryListeners = new ListenerSet<[]>();
  private readonly resultListeners = new ListenerSet<
    [readonly IndicatorUpdate[]]
  >();
  private readonly unsubscribeStore: () => void;
  private readonly getProfiler: () => RenderProfiler;
  private readonly backend: IndicatorBackend;
  private readonly stats = new IndicatorStatsCollector();
  private seq = 0;

  constructor(
    private readonly store: CandleStore,
    options: IndicatorEngineOptions = {}
  ) {
    this.registry = options.registry ?? createIndicatorRegistry();
    this.getProfiler = options.getProfiler ?? (() => NOOP_PROFILER);
    this.backend = options.backend ?? synchronousIndicatorBackend;
    this.scheduler = new IndicatorScheduler(
      (work) => this.run(work),
      options.requestFrame
    );
    this.unsubscribeStore = store.subscribe((change, s) =>
      this.scheduler.onStoreChange(change, s.length)
    );
  }

  /* ------------------------------ Definitions ------------------------------ */

  /** Adds an indicator; returns its id. Throws on unknown type / duplicate id. */
  add(input: IndicatorInput): string {
    const module = this.moduleFor(input.type);
    const id = input.id ?? this.nextId(input.type);
    if (this.active.has(id)) {
      throw new Error(`Indicator "${id}" already exists`);
    }
    this.insert(module, input, id);
    this.commitEntries();
    return id;
  }

  /** Removes an indicator; `false` when unknown. */
  remove(id: string): boolean {
    if (!this.drop(id)) {
      return false;
    }
    this.commitEntries();
    return true;
  }

  /**
   * Updates config / style / pane. A config change triggers a full
   * recalculation; style changes only re-render. `false` when unknown.
   */
  update(id: string, patch: IndicatorPatch): boolean {
    const current = this.active.get(id);
    if (!current) {
      return false;
    }
    if (patch.type !== undefined && patch.type !== current.entry.meta.type) {
      const module = this.moduleFor(patch.type);
      this.drop(id, true);
      this.insert(module, { ...patch, type: patch.type }, id);
    } else {
      this.patch(current, patch);
    }
    this.commitEntries();
    return true;
  }

  /**
   * Replaces the whole set (declarative API). Inputs are matched by id
   * (default `${type}-${position}`); unchanged configs keep their cache.
   * Throws on an unknown type without changing the current set.
   */
  setIndicators(inputs: readonly IndicatorInput[]): void {
    const modules = inputs.map((input) => this.moduleFor(input.type));
    const ids = inputs.map((input, i) => input.id ?? `${input.type}-${i}`);
    const keep = new Set(ids);
    for (const id of [...this.order]) {
      if (!keep.has(id)) {
        this.drop(id);
      }
    }
    inputs.forEach((input, i) => {
      const id = ids[i] as string;
      const current = this.active.get(id);
      if (current && current.entry.meta.type === input.type) {
        this.patch(current, input);
      } else {
        this.drop(id, true);
        this.insert(modules[i] as IndicatorModule, input, id);
      }
    });
    this.order = ids.filter((id, i) => ids.indexOf(id) === i);
    this.commitEntries();
  }

  /** Active indicators in display order (stable reference until a change). */
  getEntries(): readonly IndicatorEntry[] {
    return this.entries;
  }

  /** Latest computed result (may lag the store until the next flush). */
  getResult(id: string): IndicatorResult | undefined {
    return this.active.has(id) ? this.cache.peek(id)?.result : undefined;
  }

  subscribeEntries(listener: () => void): () => void {
    return this.entryListeners.add(listener);
  }

  subscribeResults(listener: IndicatorUpdateListener): () => void {
    return this.resultListeners.add(listener);
  }

  /** Full updates for every computed indicator (initial UI sync). */
  snapshotUpdates(): IndicatorUpdate[] {
    return snapshotUpdates(this.cache, this.order);
  }

  /** Full vs incremental computation counters (instrumentation). */
  getComputeStats(): IndicatorComputeStats {
    return this.stats.snapshot();
  }

  resetComputeStats(): void {
    this.stats.reset();
  }

  /** Computes pending work now instead of at the next frame. */
  flush(): void {
    this.scheduler.flush();
  }

  dispose(): void {
    this.unsubscribeStore();
    this.scheduler.dispose();
    this.cache.clear();
    this.entryListeners.clear();
    this.resultListeners.clear();
  }

  /* -------------------------------- Internals -------------------------------- */

  private moduleFor(type: string): IndicatorModule {
    const module = this.registry.get(type);
    if (!module) {
      throw new Error(`Unknown indicator type "${type}"`);
    }
    return module;
  }

  private nextId(type: string): string {
    let id: string;
    do {
      id = `${type}-${++this.seq}`;
    } while (this.active.has(id));
    return id;
  }

  private insert(
    module: IndicatorModule,
    input: IndicatorInput,
    id: string
  ): void {
    const { entry, config } = createIndicatorEntry(module, input, id);
    this.active.set(id, {
      id,
      entry,
      module,
      config,
      configVersion: 0,
      dirty: true,
    });
    this.removed = this.removed.filter((r) => r !== id);
    if (!this.order.includes(id)) {
      this.order.push(id);
    }
    this.scheduler.request();
  }

  private patch(current: ActiveIndicator, patch: IndicatorPatch): void {
    const { entry, config } = createIndicatorEntry(
      current.module,
      { ...patch, type: current.entry.meta.type },
      current.entry.id,
      current.entry
    );
    const configChanged = !sameConfig(
      entry.definition.config,
      current.entry.definition.config
    );
    current.entry = entry;
    current.config = config;
    if (configChanged) {
      current.configVersion++;
      current.dirty = true;
      this.scheduler.request();
    }
  }

  /** `keepPosition`: the id is re-inserted right away (type change). */
  private drop(id: string, keepPosition = false): boolean {
    if (!this.active.delete(id)) {
      return false;
    }
    this.cache.delete(id);
    if (!keepPosition) {
      this.order = this.order.filter((o) => o !== id);
    }
    this.removed.push(id);
    this.scheduler.request();
    return true;
  }

  private commitEntries(): void {
    this.entries = this.order.map(
      (id) => (this.active.get(id) as ActiveIndicator).entry
    );
    this.entryListeners.emit();
  }

  private run(work: PendingIndicatorWork): void {
    const profiler = this.getProfiler();
    const t0 = profiler.begin();
    const { store } = this;
    const updates: IndicatorUpdate[] = this.removed.map((id) => ({
      id,
      removed: true as const,
    }));
    this.removed = [];
    const tasks: ActiveIndicator[] = [];
    for (const id of this.order) {
      tasks.push(this.active.get(id) as ActiveIndicator);
    }
    const failure = this.backend.compute(
      {
        columns: store.columns,
        version: store.version,
        resetVersion: store.resetVersion,
        firstTime: store.firstTime,
      },
      tasks,
      work,
      this.cache,
      updates
    );
    this.stats.record(updates);
    if (updates.length > 0) {
      profiler.end(t0);
      this.resultListeners.emit(updates);
    }
    if (failure !== undefined) {
      throw failure;
    }
  }
}
