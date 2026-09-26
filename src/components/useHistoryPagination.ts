import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ChartHistoryConfig } from '../core/ChartConfig';
import type { TradingChartHandle } from '../engine/ChartHandle';
import { useHistoryTrigger } from '../engine/useHistoryTrigger';
import type { LoadMoreHandler } from '../history/HistoryLoader';

/**
 * Wires `onLoadMore` (spec Phase 16): registers the handler on the
 * controller's `HistoryLoader`, installs the UI-thread left-edge trigger
 * (only while a handler exists) and returns `true` while a request is in
 * flight (React re-renders only when that flips).
 */
export function useHistoryPagination(
  handle: TradingChartHandle,
  onLoadMore: LoadMoreHandler | undefined,
  config: ChartHistoryConfig
): boolean {
  const { history } = handle;
  useEffect(() => {
    history.setHandler(onLoadMore);
    return () => history.setHandler(undefined);
  }, [history, onLoadMore]);
  const request = useCallback(() => {
    history.request();
  }, [history]);
  useHistoryTrigger(
    handle.state,
    config.loadMoreThresholdBars,
    onLoadMore !== undefined,
    request
  );
  const loading = useSyncExternalStore(
    useCallback((cb: () => void) => history.subscribe(cb), [history]),
    () => history.getState() === 'loading'
  );
  return loading;
}
