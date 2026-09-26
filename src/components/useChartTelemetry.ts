import { useCallback, useEffect, useRef } from 'react';
import { isIanaTimeZone, type ChartTimeZone } from '../axes/TimeZone';
import { isSupportedTimeZone } from '../axes/ZoneTable';
import { chartIssue, type ChartErrorHandler } from '../core/ChartErrors';
import type { ChartControllerInternals } from '../engine/ChartHandle';
import type {
  ChartPerformanceSample,
  ChartPerformanceSampleHandler,
} from '../performance/PerformanceSampler';

/**
 * Connects the telemetry props to a chart handle: `onError` receives the
 * handle's non-fatal errors (plus an unresolvable `timeZone`), and the
 * returned handler forwards performance samples to the latest
 * `onPerformanceSample` (`undefined` while the prop is unset, which keeps
 * frame collection off). Handler identity changes never resubscribe.
 */
export function useChartTelemetry(
  handle: ChartControllerInternals,
  timeZone: ChartTimeZone,
  onError: ChartErrorHandler | undefined,
  onPerformanceSample: ChartPerformanceSampleHandler | undefined
): ChartPerformanceSampleHandler | undefined {
  const onErrorRef = useRef(onError);
  const onSampleRef = useRef(onPerformanceSample);
  useEffect(() => {
    onErrorRef.current = onError;
    onSampleRef.current = onPerformanceSample;
  });

  useEffect(
    () => handle.subscribeErrors((event) => onErrorRef.current?.(event)),
    [handle]
  );

  useEffect(() => {
    if (isIanaTimeZone(timeZone) && !isSupportedTimeZone(timeZone)) {
      handle.errors.report(
        chartIssue(
          'config',
          `Time zone "${timeZone}" can't be resolved by this runtime's Intl; using UTC`,
          { timeZone }
        )
      );
    }
  }, [handle, timeZone]);

  const forward = useCallback(
    (sample: ChartPerformanceSample) => {
      try {
        onSampleRef.current?.(sample);
      } catch (error) {
        handle.errors.report(
          chartIssue('telemetry', error, { hook: 'onPerformanceSample' })
        );
      }
    },
    [handle]
  );
  return onPerformanceSample ? forward : undefined;
}
