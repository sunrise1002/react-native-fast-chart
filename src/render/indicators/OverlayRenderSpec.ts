import type { HistogramColorMode } from '../../indicators/Indicator';
import type { IndicatorEntry } from '../../indicators/IndicatorDefinitions';
import { indicatorScale } from '../../indicators/IndicatorRegistry';
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
  /** Display shift in bars (`IndicatorEntry.offsets`). */
  offset: number;
  /** Draw one dot per bar (points series) instead of a polyline. */
  dots: boolean;
}

export interface BandFillSpec {
  upper: number;
  lower: number;
  color: ColorValue;
  opacity: number;
  /** Display shift in bars (of the upper edge; both edges share it). */
  offset: number;
  /** Cloud: fill where `lower` is above `upper` with this color. */
  downColor?: ColorValue;
}

export interface LegendValueSpec {
  output: number;
  color: ColorValue;
  /** Display shift in bars: the legend of bar `j` shows value `j − offset`. */
  offset: number;
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

export interface HistogramSpec {
  output: number;
  mode: HistogramColorMode;
  /** One color per bucket (`histogramBucketCount(mode)`). */
  colors: ColorValue[];
  opacity: number;
}

/** Draw instructions of one indicator, histograms included. */
export interface IndicatorDrawSpec extends OverlayRenderSpec {
  histograms: HistogramSpec[];
}

/** Colors histograms in `'candle'` mode (volume). */
export interface HistogramThemeColors {
  up: ColorValue;
  down: ColorValue;
}

function histogramColors(
  mode: HistogramColorMode,
  defaults: readonly ColorValue[],
  single: ColorValue | undefined,
  base: ColorValue,
  volume: HistogramThemeColors
): ColorValue[] {
  if (single !== undefined) {
    return mode === 'trend'
      ? [single, single, single, single]
      : [single, single];
  }
  if (mode === 'candle') {
    return [volume.up, volume.down];
  }
  const [a = base, b = a, c = b, d = c] = defaults;
  if (mode === 'trend') {
    return [a, b, c, d];
  }
  // Sign mode reuses the strong colors of a 4-color (trend) palette.
  return defaults.length >= 4 ? [a, c] : [a, b];
}

/**
 * Resolves the strokes, band fills, histograms and legend values of one
 * visible indicator. `base` is its palette color; colors follow the
 * precedence style → series default → `base`.
 */
export function resolveIndicatorDrawSpec(
  entry: IndicatorEntry,
  base: ColorValue,
  volume: HistogramThemeColors
): IndicatorDrawSpec {
  const { id, definition, meta, label } = entry;
  const { style } = definition;
  const width =
    typeof style.lineWidth === 'number' &&
    style.lineWidth > 0 &&
    style.lineWidth < Infinity
      ? style.lineWidth
      : DEFAULT_INDICATOR_LINE_WIDTH;
  const opacity = unit(style.opacity, 1);
  const spec: IndicatorDrawSpec = {
    id,
    label,
    fills: [],
    strokes: [],
    legend: [],
    histograms: [],
  };
  const offsetOf = (output: number): number => entry.offsets?.[output] ?? 0;
  const line = (output: number, color: ColorValue, dots: boolean): void => {
    const offset = offsetOf(output);
    spec.strokes.push({ output, color, width, opacity, offset, dots });
    spec.legend.push({ output, color, offset });
  };
  meta.series.forEach((series, j) => {
    const explicit = style.colors?.[j];
    const color = explicit ?? series.defaultColor ?? base;
    if (series.kind === 'band') {
      if (style.fill !== false) {
        const fill: BandFillSpec = {
          upper: series.upper,
          lower: series.lower,
          color,
          opacity: unit(style.fillOpacity, DEFAULT_BAND_FILL_OPACITY),
          offset: offsetOf(series.upper),
        };
        if (series.downColor !== undefined) {
          fill.downColor = series.downColor;
        }
        spec.fills.push(fill);
      }
      if (series.edges !== false) {
        line(series.upper, color, false);
        line(series.lower, color, false);
      }
    } else if (series.kind === 'line' || series.kind === 'points') {
      line(series.output, color, series.kind === 'points');
    } else {
      const mode = style.histogramColorMode ?? series.colorMode ?? 'sign';
      const colors = histogramColors(
        mode,
        series.defaultColors ??
          (series.defaultColor ? [series.defaultColor] : []),
        explicit,
        base,
        volume
      );
      spec.histograms.push({ output: series.output, mode, colors, opacity });
      spec.legend.push({
        output: series.output,
        color: colors[0] as ColorValue,
        offset: 0,
      });
    }
  });
  return spec;
}

/**
 * Specs of the visible price-scaled indicators hosted by the price pane,
 * in entry order (other scales — e.g. a volume overlay — are drawn by the
 * pane layer). The n-th overlay takes palette color n (cycling) unless
 * its style or series descriptor sets one. Histograms are not drawn on
 * the price scale.
 */
export function resolveOverlaySpecs(
  entries: readonly IndicatorEntry[],
  palette: readonly ColorValue[]
): OverlayRenderSpec[] {
  const specs: OverlayRenderSpec[] = [];
  let slot = 0;
  for (const entry of entries) {
    if (
      entry.definition.paneId !== PRICE_PANE_ID ||
      indicatorScale(entry.meta).kind !== 'price'
    ) {
      continue;
    }
    const base = palette[slot % Math.max(1, palette.length)];
    slot++;
    if (!entry.definition.style.visible) {
      continue;
    }
    const { histograms, ...spec } = resolveIndicatorDrawSpec(
      entry,
      base ?? FALLBACK_INDICATOR_COLOR,
      NO_VOLUME_COLORS
    );
    spec.legend = spec.legend.filter(
      (value) => !histograms.some((h) => h.output === value.output)
    );
    specs.push(spec);
  }
  return specs;
}

const NO_VOLUME_COLORS: HistogramThemeColors = {
  up: FALLBACK_INDICATOR_COLOR,
  down: FALLBACK_INDICATOR_COLOR,
};

/** `(id, output)` pairs whose values should widen the price auto-scale. */
export interface OverlayOutputRef {
  id: string;
  output: number;
  /** Display shift in bars (see `LineStrokeSpec.offset`). */
  offset: number;
}

export function overlayAutoScaleRefs(
  specs: readonly OverlayRenderSpec[]
): OverlayOutputRef[] {
  const refs: OverlayOutputRef[] = [];
  for (const spec of specs) {
    for (const stroke of spec.strokes) {
      refs.push({ id: spec.id, output: stroke.output, offset: stroke.offset });
    }
  }
  return refs;
}
