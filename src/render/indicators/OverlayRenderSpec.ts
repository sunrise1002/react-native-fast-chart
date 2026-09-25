import type { IndicatorEntry } from '../../indicators/IndicatorDefinitions';
import { PRICE_PANE_ID } from '../../panes/Pane';
import type { ColorValue } from '../../theme/ChartTheme';

/*
 * Resolved drawing instructions for the price-pane overlays: which output
 * columns become strokes / band fills / legend values, with colors,
 * widths and opacities from the definition style, the series defaults and
 * the theme palette. Computed on the JS thread when indicators or the
 * theme change (never per frame); pure.
 */

export interface LineStrokeSpec {
  output: number;
  color: ColorValue;
  width: number;
  opacity: number;
}

export interface BandFillSpec {
  upper: number;
  lower: number;
  color: ColorValue;
  opacity: number;
}

export interface LegendValueSpec {
  output: number;
  color: ColorValue;
}

export interface OverlayRenderSpec {
  id: string;
  label: string;
  /** Band fills are drawn below all strokes. */
  fills: BandFillSpec[];
  strokes: LineStrokeSpec[];
  legend: LegendValueSpec[];
}

export const DEFAULT_INDICATOR_LINE_WIDTH = 1.5;
export const DEFAULT_BAND_FILL_OPACITY = 0.08;
/** Used when the theme palette is empty. */
export const FALLBACK_INDICATOR_COLOR = '#F0B90B';

function unit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && value >= 0
    ? Math.min(1, value)
    : fallback;
}

/**
 * Specs of the visible indicators hosted by the price pane, in entry
 * order. The n-th overlay takes palette color n (cycling) unless its
 * style or series descriptor sets one.
 */
export function resolveOverlaySpecs(
  entries: readonly IndicatorEntry[],
  palette: readonly ColorValue[]
): OverlayRenderSpec[] {
  const specs: OverlayRenderSpec[] = [];
  let slot = 0;
  for (const { id, definition, meta, label } of entries) {
    if (definition.paneId !== PRICE_PANE_ID) {
      continue;
    }
    const base = palette[slot % Math.max(1, palette.length)];
    slot++;
    const { style } = definition;
    if (!style.visible) {
      continue;
    }
    const width =
      typeof style.lineWidth === 'number' &&
      style.lineWidth > 0 &&
      style.lineWidth < Infinity
        ? style.lineWidth
        : DEFAULT_INDICATOR_LINE_WIDTH;
    const opacity = unit(style.opacity, 1);
    const spec: OverlayRenderSpec = {
      id,
      label,
      fills: [],
      strokes: [],
      legend: [],
    };
    meta.series.forEach((series, j) => {
      const color =
        style.colors?.[j] ??
        series.defaultColor ??
        base ??
        FALLBACK_INDICATOR_COLOR;
      if (series.kind === 'band') {
        if (style.fill !== false) {
          spec.fills.push({
            upper: series.upper,
            lower: series.lower,
            color,
            opacity: unit(style.fillOpacity, DEFAULT_BAND_FILL_OPACITY),
          });
        }
        for (const output of [series.upper, series.lower]) {
          spec.strokes.push({ output, color, width, opacity });
          spec.legend.push({ output, color });
        }
      } else if (series.kind === 'line') {
        spec.strokes.push({ output: series.output, color, width, opacity });
        spec.legend.push({ output: series.output, color });
      }
      // Histograms live in separate panes (P6).
    });
    specs.push(spec);
  }
  return specs;
}

/** `(id, output)` pairs whose values should widen the price auto-scale. */
export interface OverlayOutputRef {
  id: string;
  output: number;
}

export function overlayAutoScaleRefs(
  specs: readonly OverlayRenderSpec[]
): OverlayOutputRef[] {
  const refs: OverlayOutputRef[] = [];
  for (const spec of specs) {
    for (const stroke of spec.strokes) {
      refs.push({ id: spec.id, output: stroke.output });
    }
  }
  return refs;
}
