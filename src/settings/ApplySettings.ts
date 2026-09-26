import type { IndicatorEngine } from '../indicators/IndicatorEngine';
import { PRICE_PANE_ID } from '../panes/Pane';
import type { PaneManager } from '../panes/PaneManager';
import { settingsToIndicatorInputs, type ChartSettings } from './ChartSettings';

/**
 * Restores `settings` into a chart's indicator engine and pane manager:
 *
 * 1. indicator panes missing from the settings are removed;
 * 2. explicit panes are created first, so `setIndicators` fills them
 *    instead of creating automatic ones;
 * 3. the indicator set is replaced (unknown types are skipped — a stale
 *    persisted type must not break the chart); unchanged indicators keep
 *    their cached results;
 * 4. pane order and height weights are applied.
 */
export function applyChartSettings(
  engine: IndicatorEngine,
  panes: PaneManager,
  settings: ChartSettings
): void {
  const wanted = new Set(settings.panes.map((p) => p.id));
  for (const pane of panes.getPanes()) {
    if (pane.type !== 'price' && !wanted.has(pane.id)) {
      panes.remove(pane.id);
    }
  }
  for (const pane of settings.panes) {
    if (pane.explicit && pane.id !== PRICE_PANE_ID && !panes.getPane(pane.id)) {
      panes.add({
        id: pane.id,
        heightRatio: pane.heightRatio,
        minHeight: pane.minHeight,
      });
    }
  }
  const known = settings.indicators.filter((s) => engine.registry.has(s.type));
  engine.setIndicators(
    settingsToIndicatorInputs({ ...settings, indicators: known })
  );
  settings.panes.forEach((pane, index) => {
    panes.move(pane.id, index);
    panes.setHeightRatio(pane.id, pane.heightRatio);
  });
}
