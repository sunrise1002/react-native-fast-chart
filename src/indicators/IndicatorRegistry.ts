import type { ColorValue } from '../theme/ChartTheme';
import type {
  HistogramColorMode,
  Indicator,
  IndicatorResult,
} from './Indicator';
import type {
  IndicatorConfigValue,
  IndicatorParam,
  RawIndicatorConfig,
} from './IndicatorConfig';

/** Where an indicator is drawn by default. */
export type IndicatorPlacement = 'overlay' | 'pane';

/** One numeric output column of an indicator. */
export interface IndicatorOutput {
  key: string;
  name: string;
}

/** How output columns are drawn (spec §13.3 result kinds). */
export type IndicatorSeriesDescriptor =
  | {
      kind: 'line';
      name: string;
      /** Output column index. */
      output: number;
      defaultColor?: ColorValue;
    }
  | {
      kind: 'histogram';
      name: string;
      output: number;
      defaultColor?: ColorValue;
      /** Default bucket coloring (overridable by the style). */
      colorMode?: HistogramColorMode;
      /** Default color per bucket (see `HistogramColorMode`). */
      defaultColors?: readonly ColorValue[];
    }
  | {
      kind: 'band';
      name: string;
      upper: number;
      lower: number;
      defaultColor?: ColorValue;
      /**
       * Stroke both edges and show them in the legend (default `true`).
       * `false` = fill only (the edges are drawn by other series).
       */
      edges?: boolean;
      /**
       * Two-color "cloud": where `lower` is above `upper` the area is
       * filled with this color instead (Ichimoku bearish cloud).
       */
      downColor?: ColorValue;
    }
  | {
      /** One dot per bar (Parabolic SAR). */
      kind: 'points';
      name: string;
      output: number;
      defaultColor?: ColorValue;
    };

/**
 * Y-scale strategy of an indicator (spec §11.2): `'price'` shares the
 * price pane scale (overlays), `'volume'` spans `0 … max`, `'fixed'` a
 * constant range (RSI 0–100), `'zeroCentered'` the visible min / max
 * always including 0 (MACD), `'auto'` the visible min / max.
 */
export type IndicatorScaleSpec =
  | { kind: 'price' }
  | { kind: 'volume' }
  | { kind: 'fixed'; min: number; max: number }
  | { kind: 'zeroCentered' }
  | { kind: 'auto' };

/** Y-scale strategy name of an indicator. */
export type IndicatorScaleKind = IndicatorScaleSpec['kind'];

/** Legend / axis number format of an indicator's values. */
export interface IndicatorValueFormat {
  /** Fixed decimals (default: the chart's price decimals). */
  decimals?: number;
  /** Compact K / M / B notation (volume). */
  compact?: boolean;
}

/** Horizontal guide levels of a pane indicator (RSI 30 / 50 / 70). */
export interface IndicatorGuides {
  /** Dashed guide lines, in indicator value units. */
  levels: readonly number[];
  /** Optional filled zone between two levels (overbought / oversold). */
  band?: { upper: number; lower: number };
}

/** Static description of an indicator type (settings UI, legend, render). */
export interface IndicatorMeta {
  type: string;
  /** Display name, e.g. `'Exponential Moving Average'`. */
  name: string;
  /** Legend prefix, e.g. `'EMA'`. */
  shortName: string;
  placement: IndicatorPlacement;
  params: readonly IndicatorParam[];
  defaultConfig: Readonly<Record<string, IndicatorConfigValue>>;
  outputs: readonly IndicatorOutput[];
  series: readonly IndicatorSeriesDescriptor[];
  /** Y-scale strategy; default `'price'` for overlays, `'auto'` for panes. */
  scale?: IndicatorScaleSpec;
  valueFormat?: IndicatorValueFormat;
  /**
   * `true` when results depend on the chart `IndicatorContext` (time
   * zone): a context change recalculates the indicator.
   */
  usesContext?: boolean;
}

/**
 * Everything the engine needs for one indicator type. `TConfig` is the
 * resolved (validated) config; raw user configs go through `resolveConfig`.
 */
export interface IndicatorModule<TConfig = unknown> {
  meta: IndicatorMeta;
  indicator: Indicator<TConfig, IndicatorResult>;
  /** Tolerant: invalid values fall back to defaults, never throws. */
  resolveConfig(raw: RawIndicatorConfig | null | undefined): TConfig;
  /** Legend label for a resolved config, e.g. `'EMA 20'`. */
  formatLabel(config: TConfig): string;
  /** Guide levels for a resolved config (pane indicators). */
  guides?(config: TConfig): IndicatorGuides;
  /**
   * Horizontal display shift per output column, in bars (TradingView
   * plot `offset`): value `i` of output `k` is drawn at bar
   * `i + offsets[k]`. Positive values reach into the empty area right of
   * the last bar (Ichimoku leading spans). Omitted = no shift.
   */
  outputOffsets?(config: TConfig): readonly number[];
}

/** Scale strategy of `meta` with the placement default applied. */
export function indicatorScale(meta: IndicatorMeta): IndicatorScaleSpec {
  return (
    meta.scale ?? { kind: meta.placement === 'overlay' ? 'price' : 'auto' }
  );
}

/**
 * Registry of indicator types by `type` key (spec Phase 7.2). Built-ins
 * are registered by `createIndicatorRegistry()`; apps add custom
 * indicators with `register`.
 */
export class IndicatorRegistry {
  private readonly modules = new Map<string, IndicatorModule>();

  /**
   * Adds (or with `replace`, overrides) an indicator type. Throws on an
   * empty type, a type mismatch between meta and indicator, or a
   * duplicate registration without `replace`.
   */
  register<TConfig>(module: IndicatorModule<TConfig>, replace = false): void {
    const { type } = module.meta;
    if (typeof type !== 'string' || type === '') {
      throw new Error('IndicatorRegistry: indicator type must be non-empty');
    }
    if (module.indicator.type !== type) {
      throw new Error(
        `IndicatorRegistry: meta type "${type}" does not match indicator type "${module.indicator.type}"`
      );
    }
    if (!replace && this.modules.has(type)) {
      throw new Error(`IndicatorRegistry: "${type}" is already registered`);
    }
    this.modules.set(type, module as IndicatorModule);
  }

  unregister(type: string): boolean {
    return this.modules.delete(type);
  }

  has(type: string): boolean {
    return this.modules.has(type);
  }

  get(type: string): IndicatorModule | undefined {
    return this.modules.get(type);
  }

  /** Metadata of every registered type, in registration order. */
  list(): IndicatorMeta[] {
    return Array.from(this.modules.values(), (m) => m.meta);
  }
}
