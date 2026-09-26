import { ListenerSet } from '../utils/ListenerSet';

/**
 * Connection state of the realtime feed as reported by the host (spec
 * Phase 15.5). The chart does not own the socket; the host sets the status
 * and renders it (badge, banner) from `subscribe` / `get`.
 */
export type RealtimeStatus = 'live' | 'reconnecting' | 'delayed' | 'offline';

export const REALTIME_STATUSES: readonly RealtimeStatus[] = Object.freeze([
  'live',
  'reconnecting',
  'delayed',
  'offline',
]);

export function isRealtimeStatus(value: unknown): value is RealtimeStatus {
  return REALTIME_STATUSES.includes(value as RealtimeStatus);
}

/** Tiny observable holding the current `RealtimeStatus` (pure TS). */
export class RealtimeStatusStore {
  private status: RealtimeStatus;
  private readonly listeners = new ListenerSet<[RealtimeStatus]>();

  constructor(initial: RealtimeStatus = 'offline') {
    this.status = initial;
  }

  get(): RealtimeStatus {
    return this.status;
  }

  /** Updates the status; `false` for an unknown value (ignored) or no change. */
  set(status: RealtimeStatus): boolean {
    if (!isRealtimeStatus(status) || status === this.status) {
      return false;
    }
    this.status = status;
    this.listeners.emit(status);
    return true;
  }

  subscribe(listener: (status: RealtimeStatus) => void): () => void {
    return this.listeners.add(listener);
  }

  dispose(): void {
    this.listeners.clear();
  }
}
