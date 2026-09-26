import {
  chartIssue,
  reportChartError,
  type ChartErrorEvent,
  type ChartErrorHandler,
} from '../core/ChartErrors';
import type { CandleIssue } from '../data/CandleValidation';
import type { HistoryLoader } from '../history/HistoryLoader';

/**
 * Fan-out of non-fatal chart errors to `subscribeErrors` listeners (the
 * `onError` prop among them). Each listener is guarded: a throwing
 * listener never reaches the data feed that triggered the report.
 */
export class ChartErrorChannel {
  private listeners: readonly ChartErrorHandler[] = [];

  subscribe(listener: ChartErrorHandler): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  report(event: ChartErrorEvent): void {
    for (const listener of this.listeners) {
      reportChartError(listener, event);
    }
  }

  get size(): number {
    return this.listeners.length;
  }

  clear(): void {
    this.listeners = [];
  }
}

/** `data` issue for rows dropped by `setData` / the `candles` prop. */
export function droppedRowsIssue(
  received: number,
  kept: number,
  issues?: readonly CandleIssue[]
): ChartErrorEvent {
  const dropped = received - kept;
  const first = issues?.[0];
  return chartIssue(
    'data',
    `${dropped} of ${received} candles dropped (malformed or duplicate)`,
    first === undefined
      ? { received, kept }
      : { received, kept, firstIndex: first.index, firstReason: first.reason }
  );
}

/** `data` issue for a realtime bar the store rejected. */
export function rejectedBarIssue(
  operation: string,
  bar: unknown
): ChartErrorEvent {
  const time =
    bar !== null && typeof bar === 'object'
      ? (bar as { time?: unknown }).time
      : undefined;
  return chartIssue('data', `${operation} rejected an invalid bar`, {
    operation,
    time,
  });
}

/** Reports each new history failure (`onLoadMore` threw / rejected). */
export function reportHistoryErrors(
  history: HistoryLoader,
  channel: ChartErrorChannel
): () => void {
  let reported: unknown;
  return history.subscribe(() => {
    if (history.getState() !== 'error') {
      reported = undefined;
      return;
    }
    const error = history.getError();
    if (error !== reported) {
      reported = error;
      channel.report(chartIssue('history', error));
    }
  });
}
