/**
 * Error telemetry (spec §26, §32 "production error telemetry hooks").
 * Pure TS: no React / Skia imports.
 */

/**
 * Where an error came from:
 * - `render`: a React render / lifecycle error caught by the chart's error
 *   boundary (the chart shows its fallback; `fatal: true`);
 * - `data`: rows dropped as malformed, or a rejected realtime bar;
 * - `indicator`: an indicator threw while computing (its result is
 *   dropped, the other indicators keep running);
 * - `history`: `onLoadMore` threw or rejected (retried after
 *   `history.retryDelayMs`);
 * - `config`: an unusable option (e.g. an unknown IANA time zone);
 * - `telemetry`: `onPerformanceSample` threw.
 */
export type ChartErrorSource =
  'render' | 'data' | 'indicator' | 'history' | 'config' | 'telemetry';

/** Error reported through `onError` / `subscribeErrors`. */
export interface ChartErrorEvent {
  source: ChartErrorSource;
  error: Error;
  /** `true` when the chart could not render and shows its fallback. */
  fatal: boolean;
  /** React component stack (`render` errors only). */
  componentStack?: string;
  /** Source-specific context (dropped row count, indicator id, …). */
  details?: Readonly<Record<string, unknown>>;
}

/** Receives chart errors on the JS thread. Must not throw (it is guarded). */
export type ChartErrorHandler = (event: ChartErrorEvent) => void;

/** Normalizes any thrown value into an `Error` (message preserved). */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = Object.prototype.toString.call(value);
  }
  return new Error(`Non-error thrown: ${text}`);
}

/**
 * Calls `handler` with `event`, swallowing anything the handler throws:
 * telemetry must never break the chart or the caller (a realtime feed).
 * Returns `false` when there was no handler or it threw.
 */
export function reportChartError(
  handler: ChartErrorHandler | null | undefined,
  event: ChartErrorEvent
): boolean {
  if (typeof handler !== 'function') {
    return false;
  }
  try {
    handler(event);
    return true;
  } catch {
    return false;
  }
}

/** Builds a non-fatal event. */
export function chartIssue(
  source: ChartErrorSource,
  error: unknown,
  details?: Readonly<Record<string, unknown>>
): ChartErrorEvent {
  return details === undefined
    ? { source, error: toError(error), fatal: false }
    : { source, error: toError(error), fatal: false, details };
}
