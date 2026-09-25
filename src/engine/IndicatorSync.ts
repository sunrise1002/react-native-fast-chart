import { scheduleOnUI } from 'react-native-worklets';
import type {
  IndicatorEngine,
  IndicatorUpdate,
} from '../indicators/IndicatorEngine';
import {
  applyIndicatorPayloads,
  emptyUiIndicatorSet,
  packIndicatorUpdate,
  type IndicatorPayload,
} from '../indicators/UiIndicatorSet';
import type { ChartSharedState } from './ChartSharedState';

function applyPayloads(
  state: ChartSharedState,
  payloads: IndicatorPayload[],
  reset: boolean
): void {
  'worklet';
  if (reset) {
    state.indicators.value = emptyUiIndicatorSet();
  }
  state.indicators.modify((set) => {
    'worklet';
    applyIndicatorPayloads(set, payloads);
    return set;
  }, true);
}

/**
 * Mirrors the engine's results into `state.indicators` on the UI thread:
 * one `scheduleOnUI` per flush (all indicators batched), full snapshots
 * after recalculations, packed tails for realtime ticks. Pushes the
 * current results immediately; returns the unsubscribe function.
 */
export function connectIndicatorsToUi(
  engine: IndicatorEngine,
  state: ChartSharedState
): () => void {
  const push = (updates: readonly IndicatorUpdate[], reset: boolean) => {
    scheduleOnUI(applyPayloads, state, updates.map(packIndicatorUpdate), reset);
  };
  push(engine.snapshotUpdates(), true);
  return engine.subscribeResults((updates) => push(updates, false));
}
