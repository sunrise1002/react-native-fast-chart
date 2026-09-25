/**
 * Minimal synchronous listener list. Emission iterates a snapshot, so
 * listeners may unsubscribe (or subscribe) while being notified.
 */
export class ListenerSet<TArgs extends unknown[]> {
  private listeners: readonly ((...args: TArgs) => void)[] = [];

  /** Adds `listener`; returns its unsubscribe function. */
  add(listener: (...args: TArgs) => void): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(...args: TArgs): void {
    for (const listener of this.listeners) {
      listener(...args);
    }
  }

  clear(): void {
    this.listeners = [];
  }

  get size(): number {
    return this.listeners.length;
  }
}
