import type { IndicatorEngine } from '../indicators/IndicatorEngine';
import { PRICE_PANE_ID } from './Pane';
import type { PaneManager } from './PaneManager';

/**
 * Removes an indicator (its cache goes with it) and the pane it leaves
 * empty: automatic panes vanish on the next pane sync anyway, explicit
 * ones are removed here. The price pane always stays. `false` if unknown.
 */
export function removeIndicatorAndEmptyPane(
  engine: IndicatorEngine,
  panes: PaneManager,
  id: string
): boolean {
  const entry = engine.getEntries().find((e) => e.id === id);
  if (!entry || !engine.remove(id)) {
    return false;
  }
  const pane = panes.getPane(entry.definition.paneId);
  if (pane && pane.id !== PRICE_PANE_ID && pane.indicatorIds.length === 0) {
    panes.remove(pane.id);
  }
  return true;
}

/** Removes a non-price pane with all its indicators. `false` if unknown. */
export function removePaneWithIndicators(
  engine: IndicatorEngine,
  panes: PaneManager,
  id: string
): boolean {
  const pane = panes.getPane(id);
  if (!pane || pane.type === 'price') {
    return false;
  }
  for (const indicatorId of pane.indicatorIds) {
    engine.remove(indicatorId);
  }
  panes.remove(id);
  return true;
}
