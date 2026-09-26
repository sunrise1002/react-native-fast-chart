import { cancelAnimation, withTiming } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import type { ViewportResetPolicy } from '../core/ChartController';
import type { CandleStore, CandleStoreChange } from '../data/CandleStore';
import {
  applyPackedBars,
  createUiCandleSeries,
  packBars,
  type UiCandleSeries,
} from '../data/UiCandleSeries';
import { isLastBarVisible } from '../viewport/TimeScale';
import {
  appendOffsetShift,
  shiftIndexForPrepend,
} from '../viewport/ViewportShift';
import {
  readTimeScale,
  type ChartSharedState,
  type ViewportOptions,
} from './ChartSharedState';
import { hideCrosshair } from './CrosshairActions';
import { resetViewport, scrollToRealtime } from './ViewportActions';

/**
 * Mirrors a JS-thread `CandleStore` into `state.series` on the UI thread.
 *
 * - `reset`: full snapshot + viewport per the reset policy (new symbol /
 *   timeframe); the crosshair is hidden (its bar no longer exists).
 * - `prepend` / large or shrinking `patch`: full snapshot. The viewport is
 *   anchored at the right edge, so older bars never move the view; the
 *   crosshair bar index is shifted by the prepended count.
 * - `append` / `updateLast` / small tail `patch`: packed bars written in
 *   place (O(bars changed), no snapshot). Appends follow realtime when the
 *   last bar was on screen (and `followRealtime` is on); otherwise
 *   `rightOffset` absorbs them so the view holds still.
 */

/** Tail updates up to this many bars are patched in place. */
export const MAX_PATCH_BARS = 512;

/** How a snapshot affects the viewport. */
type SnapshotView = ViewportResetPolicy | 'keep';

function installSnapshot(
  state: ChartSharedState,
  options: ViewportOptions,
  snapshot: UiCandleSeries,
  view: SnapshotView,
  prepended: number
): void {
  'worklet';
  state.series.value = snapshot;
  if (view === 'keep') {
    const index = state.crosshairIndex.value;
    const shifted = shiftIndexForPrepend(index, prepended);
    if (shifted !== index) {
      state.crosshairIndex.value = shifted;
    }
    return;
  }
  hideCrosshair(state, 0, false);
  state.crosshairIndex.value = -1;
  if (view === 'reset') {
    resetViewport(state, options, false);
  } else {
    scrollToRealtime(state, options, false);
  }
}

function pulseLastPrice(state: ChartSharedState, durationMs: number): void {
  'worklet';
  // At most one pulse per duration, however fast the feed ticks.
  if (state.lastPricePulse.value >= 1) {
    cancelAnimation(state.lastPricePulse);
    state.lastPricePulse.value = 0;
    state.lastPricePulse.value = withTiming(1, { duration: durationMs });
  }
}

function applyTail(
  state: ChartSharedState,
  options: ViewportOptions,
  from: number,
  packed: Float64Array
): void {
  'worklet';
  const series = state.series.value;
  const before = series.length;
  const lastBarVisible = isLastBarVisible(readTimeScale(state));
  const lastClose = before > 0 ? (series.close[before - 1] as number) : NaN;
  state.series.modify((s) => {
    'worklet';
    applyPackedBars(s, from, packed);
    return s;
  }, true);
  const shift = appendOffsetShift(
    series.length - before,
    before,
    lastBarVisible,
    options.followRealtime
  );
  if (shift !== 0) {
    state.rightOffset.value += shift;
    state.rawOffset.value += shift;
  }
  if (
    options.pulseDurationMs > 0 &&
    series.close[series.length - 1] !== lastClose
  ) {
    pulseLastPrice(state, options.pulseDurationMs);
  }
}

/**
 * Pushes the store to the UI thread now and on every change; returns the
 * unsubscribe function. `getOptions` is read at push time (config
 * changes); `getResetPolicy` when the dataset is replaced.
 */
export function connectStoreToUi(
  store: CandleStore,
  state: ChartSharedState,
  getOptions: () => ViewportOptions,
  getResetPolicy: () => ViewportResetPolicy = () => 'reset'
): () => void {
  const pushSnapshot = (view: SnapshotView, prepended: number) => {
    const snapshot = createUiCandleSeries(
      store.columns,
      store.version,
      store.resetVersion
    );
    scheduleOnUI(
      installSnapshot,
      state,
      getOptions(),
      snapshot,
      view,
      prepended
    );
  };
  const pushTail = (from: number) => {
    scheduleOnUI(
      applyTail,
      state,
      getOptions(),
      from,
      packBars(store.columns, from, store.length - from)
    );
  };

  pushSnapshot(getResetPolicy(), 0);
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
    } else if (kind === 'reset') {
      pushSnapshot(getResetPolicy(), 0);
    } else {
      pushSnapshot('keep', kind === 'prepend' ? change.count : 0);
    }
  });
}
