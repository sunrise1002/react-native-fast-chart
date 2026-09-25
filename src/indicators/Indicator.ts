import type { Candle, UnixMs } from '../data/Candle';

/**
 * Pure indicator contract (spec §13.1). Implementations must not import
 * React or Skia. Implemented from phase P5 onwards.
 */
export interface Indicator<TConfig, TResult> {
  readonly id: string;
  readonly type: string;

  calculate(candles: readonly Candle[], config: TConfig): TResult;

  /**
   * Incremental update after the candle at `changedIndex` changed or was
   * appended. Must not recompute the whole series.
   */
  update?(
    previous: TResult,
    candles: readonly Candle[],
    changedIndex: number,
    config: TConfig
  ): TResult;
}

export interface IndicatorStyle {
  visible: boolean;
  lineWidth?: number;
  opacity?: number;
  /** Explicit colors; falls back to `ChartTheme.indicatorPalette`. */
  colors?: readonly string[];
}

/** Serializable description of an indicator instance (spec §13.2). */
export interface IndicatorDefinition {
  id: string;
  /** Registry key, e.g. `'ema'`, `'rsi'`. */
  type: string;
  /** Pane that hosts the indicator (`'price'` for overlays). */
  paneId: string;
  config: Readonly<Record<string, unknown>>;
  style: IndicatorStyle;
}

/* ---------------------------- Result types (§13.3) ---------------------------- */

export interface LinePoint {
  time: UnixMs;
  /** `null` during warm-up or when the value is undefined. */
  value: number | null;
}

export interface MultiLineResult {
  lines: Readonly<Record<string, readonly LinePoint[]>>;
}

export type HistogramPolarity = 'positive' | 'negative' | 'neutral';

export interface HistogramPoint {
  time: UnixMs;
  value: number;
  polarity?: HistogramPolarity;
}

export interface BandPoint {
  time: UnixMs;
  upper: number;
  middle?: number;
  lower: number;
}
