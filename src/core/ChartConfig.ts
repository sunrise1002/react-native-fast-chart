import { deepMerge, type DeepPartial } from '../utils/deepMerge';

/** Developer diagnostics. All flags default to `false` (zero cost). */
export interface ChartDebugConfig {
  /** Draws the FPS / render-time overlay on top of the chart. */
  overlay: boolean;
  /** Collects frame/render timings in `ChartMetrics`. */
  profiling: boolean;
}

export interface ChartLayoutConfig {
  /** Width reserved for the right price axis, dp. */
  priceAxisWidth: number;
  /** Height reserved for the bottom time axis, dp. */
  timeAxisHeight: number;
  /** Empty space right of the last bar, in bars. */
  rightOffsetBars: number;
}

export interface ChartViewportConfig {
  /** Initial distance between bar centers, dp. */
  initialBarSpacing: number;
  /** Zoom-in limit, dp per bar. */
  maxBarSpacing: number;
  /** Zoom-out limit, dp per bar (may be < 1 for conflated rendering). */
  minBarSpacing: number;
}

export interface ChartInteractionConfig {
  panEnabled: boolean;
  pinchEnabled: boolean;
  crosshairEnabled: boolean;
}

/** Static chart options. Changing them is not a per-frame operation. */
export interface ChartConfig {
  layout: ChartLayoutConfig;
  viewport: ChartViewportConfig;
  interaction: ChartInteractionConfig;
  debug: ChartDebugConfig;
}

export const DEFAULT_CHART_CONFIG: Readonly<ChartConfig> = Object.freeze({
  layout: Object.freeze({
    priceAxisWidth: 64,
    timeAxisHeight: 24,
    rightOffsetBars: 5,
  }),
  viewport: Object.freeze({
    initialBarSpacing: 8,
    maxBarSpacing: 64,
    minBarSpacing: 0.5,
  }),
  interaction: Object.freeze({
    panEnabled: true,
    pinchEnabled: true,
    crosshairEnabled: true,
  }),
  debug: Object.freeze({
    overlay: false,
    profiling: false,
  }),
});

/** Resolves a user-supplied partial config against the defaults. */
export function resolveChartConfig(
  override?: DeepPartial<ChartConfig> | null
): ChartConfig {
  return deepMerge<ChartConfig>(DEFAULT_CHART_CONFIG, override);
}
