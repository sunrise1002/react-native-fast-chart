import { scheduleOnUI } from 'react-native-worklets';
import type { CandleStore, CandleStoreChange } from '../data/CandleStore';
import {
  applyPackedBars,
  createUiCandleSeries,
  packBars,
  type UiCandleSeries,
} from '../data/UiCandleSeries';
import { isLastBarVisible } from '../viewport/TimeScale';
import {
  readTimeScale,
  type ChartSharedState,
  type ViewportOptions,
} from './ChartSharedState';
import { resetViewport } from './ViewportActions';

/**
 * Mirrors a JS-thread `CandleStore` into `state.series` on the UI thread.
 *
 * - `reset`: full snapshot + viewport reset (new symbol / timeframe).
 * - `prepend` / large or shrinking `patch`: full snapshot. The viewport is
 *   anchored at the right edge, so older bars never move the view.
 * - `append` / `updateLast` / small tail `patch`: packed bars written in
 *   place (O(bars changed), no snapshot). When the user is scrolled into
 *   history, appends shift `rightOffset` so the view holds still;
 *   at realtime the chart follows the new bar.
 */

/** Tail updates up to this many bars are patched in place. */
export const MAX_PATCH_BARS = 512;

function installSnapshot(
  state: ChartSharedState,
  options: ViewportOptions,
  snapshot: UiCandleSeries,
  resetView: boolean
): void {
  'worklet';
  state.series.value = snapshot;
  if (resetView) {
    resetViewport(state, options, false);
  }
}

function applyTail(
  state: ChartSharedState,
  from: number,
  packed: Float64Array
): void {
  'worklet';
  const series = state.series.value;
  const before = series.length;
  const scrolledBack = !isLastBarVisible(readTimeScale(state));
  state.series.modify((s) => {
    'worklet';
    applyPackedBars(s, from, packed);
    return s;
  }, true);
  const appended = series.length - before;
  if (appended > 0 && before > 0 && scrolledBack) {
    // Hold the view still while the user inspects history.
    state.rightOffset.value += appended;
    state.rawOffset.value += appended;
  }
}

/**
 * Pushes the store to the UI thread now and on every change; returns the
 * unsubscribe function. `getOptions` is read at push time (config changes).
 */
export function connectStoreToUi(
  store: CandleStore,
  state: ChartSharedState,
  getOptions: () => ViewportOptions
): () => void {
  const pushSnapshot = (resetView: boolean) => {
    const snapshot = createUiCandleSeries(
      store.columns,
      store.version,
      store.resetVersion
    );
    scheduleOnUI(installSnapshot, state, getOptions(), snapshot, resetView);
  };
  const pushTail = (from: number) => {
    scheduleOnUI(
      applyTail,
      state,
      from,
      packBars(store.columns, from, store.length - from)
    );
  };

  pushSnapshot(true);
  return store.subscribe((change: CandleStoreChange) => {
    const { kind } = change;
    if (kind === 'updateLast') {
      pushTail(store.length - 1);
    } else if (
      (kind === 'append' || kind === 'patch') &&
      change.count >= 0 &&
      store.length - change.fromIndex <= MAX_PATCH_BARS
    ) {
      pushTail(change.fromIndex);
    } else {
      pushSnapshot(kind === 'reset');
    }
  });
}
