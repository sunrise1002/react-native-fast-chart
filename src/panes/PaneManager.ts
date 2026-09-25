import { ListenerSet } from '../utils/ListenerSet';
import {
  createPricePane,
  DEFAULT_INDICATOR_PANE_MIN_HEIGHT,
  DEFAULT_INDICATOR_PANE_RATIO,
  PRICE_PANE_ID,
  sanitizePaneMinHeight,
  sanitizePaneRatio,
  type PaneDefinition,
  type PaneInput,
} from './Pane';

/** What the manager needs to know about an indicator (an `IndicatorEntry`). */
export interface PaneIndicatorRef {
  readonly id: string;
  readonly definition: { readonly paneId: string };
}

/**
 * Pane manager (spec §12.2, Phase 9.1 / 9.5). Pure TypeScript.
 *
 * Owns the ordered pane list: the price pane is always first and cannot be
 * removed or moved. Indicators are assigned to panes through their
 * `paneId` (`sync`): an unknown pane id creates an *automatic* pane at the
 * end, which disappears again with its last indicator. Panes created by
 * `add` are *explicit* and stay until `remove`d, even when empty.
 *
 * `getPanes()` returns an immutable snapshot that only changes identity
 * when something changed (for `useSyncExternalStore`).
 */
export class PaneManager {
  private panes: readonly PaneDefinition[] = [createPricePane()];
  private readonly explicit = new Set<string>([PRICE_PANE_ID]);
  private readonly listeners = new ListenerSet<[]>();
  private seq = 0;

  getPanes(): readonly PaneDefinition[] {
    return this.panes;
  }

  getPane(id: string): PaneDefinition | undefined {
    return this.panes.find((p) => p.id === id);
  }

  subscribe(listener: () => void): () => void {
    return this.listeners.add(listener);
  }

  /** Adds an explicit (empty) pane; returns its id. Throws on a duplicate. */
  add(input: PaneInput = {}): string {
    const id = input.id ?? this.nextId();
    if (typeof id !== 'string' || id === '') {
      throw new Error('PaneManager: pane id must be a non-empty string');
    }
    if (this.getPane(id)) {
      throw new Error(`PaneManager: pane "${id}" already exists`);
    }
    const pane = this.newPane(id, input);
    const next = [...this.panes];
    next.splice(this.insertIndex(input.index), 0, pane);
    this.explicit.add(id);
    this.commit(next);
    return id;
  }

  /**
   * Removes a pane (not the price pane). Returns the removed definition —
   * the caller removes its indicators — or `undefined`.
   */
  remove(id: string): PaneDefinition | undefined {
    const pane = this.getPane(id);
    if (!pane || pane.type === 'price') {
      return undefined;
    }
    this.explicit.delete(id);
    this.commit(this.panes.filter((p) => p !== pane));
    return pane;
  }

  /** Moves a pane to `index` (clamped behind the price pane). */
  move(id: string, index: number): boolean {
    const from = this.panes.findIndex((p) => p.id === id);
    if (from < 1 || !Number.isFinite(index)) {
      return false;
    }
    const to = Math.min(this.panes.length - 1, Math.max(1, Math.round(index)));
    if (to === from) {
      return true;
    }
    const next = [...this.panes];
    const [pane] = next.splice(from, 1);
    next.splice(to, 0, pane as PaneDefinition);
    this.commit(next);
    return true;
  }

  /** Changes one pane's height weight (invalid values are ignored). */
  setHeightRatio(id: string, ratio: number): boolean {
    const index = this.panes.findIndex((p) => p.id === id);
    if (index < 0 || sanitizePaneRatio(ratio, NaN) !== ratio) {
      return false;
    }
    return this.resize(
      this.panes.map((p, i) => (i === index ? ratio : p.heightRatio))
    );
  }

  /**
   * Replaces all height weights at once, in pane order (separator drag
   * commit). Rejected when the length differs; invalid entries keep the
   * current ratio.
   */
  resize(ratios: readonly number[]): boolean {
    if (ratios.length !== this.panes.length) {
      return false;
    }
    let changed = false;
    const next = this.panes.map((p, i) => {
      const ratio = sanitizePaneRatio(ratios[i], p.heightRatio);
      if (ratio === p.heightRatio) {
        return p;
      }
      changed = true;
      return { ...p, heightRatio: ratio };
    });
    if (changed) {
      this.commit(next);
    }
    return true;
  }

  /**
   * Assigns indicators to panes by their `paneId` (entry order), creating
   * automatic panes for unknown ids and dropping automatic panes left
   * without indicators.
   */
  sync(indicators: readonly PaneIndicatorRef[]): void {
    const byPane = new Map<string, string[]>();
    for (const { id, definition } of indicators) {
      const list = byPane.get(definition.paneId);
      if (list) {
        list.push(id);
      } else {
        byPane.set(definition.paneId, [id]);
      }
    }
    const next: PaneDefinition[] = [];
    for (const pane of this.panes) {
      const ids = byPane.get(pane.id) ?? [];
      byPane.delete(pane.id);
      if (ids.length === 0 && !this.explicit.has(pane.id)) {
        continue;
      }
      next.push(
        sameIds(pane.indicatorIds, ids) ? pane : { ...pane, indicatorIds: ids }
      );
    }
    for (const [paneId, ids] of byPane) {
      next.push({ ...this.newPane(paneId, {}), indicatorIds: ids });
    }
    if (
      next.length !== this.panes.length ||
      next.some((p, i) => p !== this.panes[i])
    ) {
      this.commit(next);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }

  private newPane(id: string, input: PaneInput): PaneDefinition {
    return {
      id,
      type: 'indicator',
      heightRatio: sanitizePaneRatio(
        input.heightRatio,
        DEFAULT_INDICATOR_PANE_RATIO
      ),
      minHeight: sanitizePaneMinHeight(
        input.minHeight,
        DEFAULT_INDICATOR_PANE_MIN_HEIGHT
      ),
      indicatorIds: [],
    };
  }

  private insertIndex(index: number | undefined): number {
    const last = this.panes.length;
    if (index === undefined || !Number.isFinite(index)) {
      return last;
    }
    return Math.min(last, Math.max(1, Math.round(index)));
  }

  private nextId(): string {
    let id: string;
    do {
      id = `pane-${++this.seq}`;
    } while (this.getPane(id));
    return id;
  }

  private commit(next: readonly PaneDefinition[]): void {
    this.panes = next;
    this.listeners.emit();
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
