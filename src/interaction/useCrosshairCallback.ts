import { useEffect, useRef } from 'react';
import { useAnimatedReaction } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { CandleColumns } from '../data/CandleBuffer';
import type { ChartSharedState } from '../engine/ChartSharedState';

/** Bar under the crosshair, sent to `onCrosshairChange`. */
export interface CrosshairChange {
  index: number;
  /** Bar open time, Unix ms (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** `onCrosshairChange` callback: the hovered bar, or `null` when the crosshair hides. */
export type CrosshairChangeHandler = (change: CrosshairChange | null) => void;

/** Snapshot of bar `index` (`null` when out of range). Worklet. */
export function readCrosshairBar(
  series: CandleColumns,
  index: number
): CrosshairChange | null {
  'worklet';
  if (!(index >= 0 && index < series.length) || index % 1 !== 0) {
    return null;
  }
  const at = series.offset + index;
  return {
    index,
    time: series.time[at] as number,
    open: series.open[at] as number,
    high: series.high[at] as number,
    low: series.low[at] as number,
    close: series.close[at] as number,
    volume: series.volume[at] as number,
  };
}

/**
 * Calls `handler` on the JS thread when the crosshair moves to another bar
 * (with the bar) and when it hides (with `null`) — never per frame, so it
 * suits haptics (`Haptics.selectionAsync()`) or a React tooltip. Nothing is
 * installed without a handler. The latest handler is always used.
 */
export function useCrosshairCallback(
  state: ChartSharedState,
  handler: CrosshairChangeHandler | undefined
): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  const enabled = handler !== undefined;
  const dispatch = useRef((change: CrosshairChange | null) => {
    ref.current?.(change);
  }).current;
  const { series, crosshairIndex, crosshairOpacity } = state;

  useAnimatedReaction(
    () => (enabled && crosshairOpacity.value > 0 ? crosshairIndex.value : -1),
    (index, previous) => {
      if (index === previous || (previous === null && index < 0)) {
        return;
      }
      scheduleOnRN(dispatch, readCrosshairBar(series.value, index));
    },
    [enabled]
  );
}
