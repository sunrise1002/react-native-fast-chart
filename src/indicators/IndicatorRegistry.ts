import type { ColorValue } from '../theme/ChartTheme';
import type { Indicator, IndicatorResult } from './Indicator';
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
    }
  | {
      kind: 'band';
      name: string;
      upper: number;
      lower: number;
      defaultColor?: ColorValue;
    };

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
