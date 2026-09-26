import { scheduleOnUI } from 'react-native-worklets';
import type { PaneDefinition } from '../panes/Pane';
import type { PaneLayoutSpec } from '../panes/PaneLayout';
import type { PaneManager } from '../panes/PaneManager';
import type { ChartSharedState, ViewportOptions } from './ChartSharedState';
import { setPaneSpec } from './LayoutActions';

/** Layout-relevant part of the pane list (order, weights, minimums). */
export function toPaneLayoutSpec(
  panes: readonly PaneDefinition[]
): PaneLayoutSpec {
  return {
    ids: panes.map((p) => p.id),
    ratios: panes.map((p) => p.heightRatio),
    minHeights: panes.map((p) => p.minHeight),
  };
}

/**
 * Mirrors the pane list into `state.paneSpec` on the UI thread (one
 * `scheduleOnUI` per pane change — never per frame). Pushes the current
 * panes immediately; returns the unsubscribe function.
 */
export function connectPanesToUi(
  panes: PaneManager,
  state: ChartSharedState,
  getOptions: () => ViewportOptions
): () => void {
  const push = () => {
    scheduleOnUI(
      setPaneSpec,
      state,
      getOptions(),
      toPaneLayoutSpec(panes.getPanes())
    );
  };
  push();
  return panes.subscribe(push);
}
