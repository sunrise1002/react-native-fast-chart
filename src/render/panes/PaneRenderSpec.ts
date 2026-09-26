import { sanitizeDecimals } from '../../axes/PriceFormat';
import type { IndicatorEntry } from '../../indicators/IndicatorDefinitions';
import {
  indicatorScale,
  type IndicatorScaleSpec,
} from '../../indicators/IndicatorRegistry';
import { PRICE_PANE_ID, type PaneDefinition } from '../../panes/Pane';
import type { ChartTheme, ColorValue } from '../../theme/ChartTheme';
import {
  FALLBACK_INDICATOR_COLOR,
  resolveIndicatorDrawSpec,
  type IndicatorDrawSpec,
  type OverlayOutputRef,
} from '../indicators/OverlayRenderSpec';

/*
 * Resolved drawing instructions per pane (spec §12, §17.4): indicators
 * with their strokes / histograms / fills, the pane's Y-scale strategy,
 * value format, guide levels and auto-scale refs. Computed on the JS
 * thread when indicators, panes or the theme change (never per frame);
 * pure.
 */

/** Value format of a pane (axis labels, legend values). */
export interface PaneValueFormat {
  /** Fixed decimals, or `-1` for the chart's price decimals. */
  decimals: number;
  /** Compact K / M / B notation. */
  compact: boolean;
}

export interface PaneGuideSpec {
  levels: number[];
  band: { upper: number; lower: number } | null;
}

export interface PaneRenderSpec {
  paneId: string;
  /**
   * `true` for non-price-scaled indicators of the price pane (volume
   * overlay): drawn in the bottom region of the price pane.
   */
  overlay: boolean;
  scale: IndicatorScaleSpec;
  format: PaneValueFormat;
  indicators: IndicatorDrawSpec[];
  guides: PaneGuideSpec;
  /** Outputs spanning the auto-scale (strokes and histograms). */
  refs: OverlayOutputRef[];
}

export const DEFAULT_PANE_FORMAT: Readonly<PaneValueFormat> = Object.freeze({
  decimals: -1,
  compact: false,
});

function paneFormat(entry: IndicatorEntry | undefined): PaneValueFormat {
  const format = entry?.meta.valueFormat;
  if (!format) {
    return { ...DEFAULT_PANE_FORMAT };
  }
  return {
    decimals:
      format.decimals === undefined
        ? -1
        : sanitizeDecimals(format.decimals, -1),
    compact: format.compact === true,
  };
}

function addGuides(guides: PaneGuideSpec, entry: IndicatorEntry): void {
  if (!entry.guides) {
    return;
  }
  for (const level of entry.guides.levels) {
    if (Number.isFinite(level) && !guides.levels.includes(level)) {
      guides.levels.push(level);
    }
  }
  const band = entry.guides.band;
  if (
    guides.band === null &&
    band &&
    Number.isFinite(band.upper) &&
    Number.isFinite(band.lower)
  ) {
    guides.band = { upper: band.upper, lower: band.lower };
  }
}

/**
 * Specs in pane order. Every indicator pane gets a spec (possibly without
 * indicators); the price pane only when it hosts non-price-scaled
 * indicators. The first visible indicator of a pane decides its scale and
 * format; guides are merged. Pane indicators take palette colors in
 * order of appearance (hidden ones keep their slot).
 */
export function resolvePaneSpecs(
  entries: readonly IndicatorEntry[],
  panes: readonly PaneDefinition[],
  theme: Pick<ChartTheme, 'indicatorPalette' | 'volume'>
): PaneRenderSpec[] {
  const palette = theme.indicatorPalette;
  const byPane = new Map<string, IndicatorEntry[]>();
  for (const entry of entries) {
    const isPrice = entry.definition.paneId === PRICE_PANE_ID;
    if (isPrice && indicatorScale(entry.meta).kind === 'price') {
      continue;
    }
    const list = byPane.get(entry.definition.paneId) ?? [];
    list.push(entry);
    byPane.set(entry.definition.paneId, list);
  }
  const specs: PaneRenderSpec[] = [];
  let slot = 0;
  for (const pane of panes) {
    const list = byPane.get(pane.id) ?? [];
    const overlay = pane.id === PRICE_PANE_ID;
    if (overlay && list.length === 0) {
      continue;
    }
    const visible = list.filter((e) => e.definition.style.visible);
    const lead = visible[0];
    const spec: PaneRenderSpec = {
      paneId: pane.id,
      overlay,
      scale: lead ? indicatorScale(lead.meta) : { kind: 'auto' },
      format: paneFormat(lead),
      indicators: [],
      guides: { levels: [], band: null },
      refs: [],
    };
    for (const entry of list) {
      const base: ColorValue =
        palette[slot % Math.max(1, palette.length)] ?? FALLBACK_INDICATOR_COLOR;
      slot++;
      if (!entry.definition.style.visible) {
        continue;
      }
      const draw = resolveIndicatorDrawSpec(entry, base, theme.volume);
      spec.indicators.push(draw);
      addGuides(spec.guides, entry);
      for (const { output } of draw.histograms) {
        spec.refs.push({ id: draw.id, output, offset: 0 });
      }
      for (const { output, offset } of draw.strokes) {
        spec.refs.push({ id: draw.id, output, offset });
      }
    }
    specs.push(spec);
  }
  return specs;
}
