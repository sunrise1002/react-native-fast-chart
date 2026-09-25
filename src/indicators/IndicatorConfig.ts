import { PRICE_SOURCES, type PriceSource } from './Indicator';

/*
 * Indicator parameter schema (drives the P7 settings UI) and tolerant
 * config resolution: missing / invalid values fall back to the default,
 * numbers are clamped to `[min, max]`, integers rounded. Resolution never
 * throws, so a bad persisted config cannot break the chart.
 */

export interface NumberParam {
  key: string;
  label: string;
  kind: 'integer' | 'number';
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface SourceParam {
  key: string;
  label: string;
  kind: 'source';
  options: readonly PriceSource[];
  default: PriceSource;
}

export type IndicatorParam = NumberParam | SourceParam;

export type IndicatorConfigValue = number | string;

export type RawIndicatorConfig = Readonly<Record<string, unknown>>;

/** Clamped / rounded value of a numeric param (default when invalid). */
export function resolveNumberParam(
  raw: RawIndicatorConfig | null | undefined,
  param: NumberParam
): number {
  const value = raw?.[param.key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return param.default;
  }
  const rounded = param.kind === 'integer' ? Math.round(value) : value;
  return Math.min(param.max, Math.max(param.min, rounded));
}

/** A valid price source of the param's options (default otherwise). */
export function resolveSourceParam(
  raw: RawIndicatorConfig | null | undefined,
  param: SourceParam
): PriceSource {
  const value = raw?.[param.key];
  return param.options.find((s) => s === value) ?? param.default;
}

/** Default config object of a schema (`key → default`). */
export function paramDefaults(
  params: readonly IndicatorParam[]
): Readonly<Record<string, IndicatorConfigValue>> {
  const out: Record<string, IndicatorConfigValue> = {};
  for (const p of params) {
    out[p.key] = p.default;
  }
  return Object.freeze(out);
}

/* ------------------------- Built-in param factories ------------------------- */

export const MAX_INDICATOR_PERIOD = 5000;

export function periodParam(defaultValue: number): NumberParam {
  return {
    key: 'period',
    label: 'Length',
    kind: 'integer',
    min: 1,
    max: MAX_INDICATOR_PERIOD,
    step: 1,
    default: defaultValue,
  };
}

export function sourceParam(defaultValue: PriceSource = 'close'): SourceParam {
  return {
    key: 'source',
    label: 'Source',
    kind: 'source',
    options: PRICE_SOURCES,
    default: defaultValue,
  };
}

/**
 * Short legend label: `shortName` followed by the resolved numeric params
 * in schema order, plus the source when it differs from the default
 * (`EMA 20`, `BB 20 2`, `SMA 50 hl2`).
 */
export function formatIndicatorLabel(
  shortName: string,
  params: readonly IndicatorParam[],
  config: Readonly<Record<string, unknown>>
): string {
  let label = shortName;
  for (const p of params) {
    const value = config[p.key];
    if (p.kind === 'source') {
      if (value !== p.default && typeof value === 'string') {
        label += ' ' + value;
      }
    } else if (typeof value === 'number') {
      label += ' ' + String(value);
    }
  }
  return label;
}
