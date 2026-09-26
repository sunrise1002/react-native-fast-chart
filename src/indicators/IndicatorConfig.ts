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

/** Price-source param descriptor. */
export interface SourceParam {
  key: string;
  label: string;
  kind: 'source';
  options: readonly PriceSource[];
  default: PriceSource;
}

/** Param picking one of a fixed set of string options (e.g. VWAP anchor). */
export interface ChoiceParam {
  key: string;
  label: string;
  kind: 'choice';
  options: readonly string[];
  default: string;
}

/** Descriptor of an indicator param (drives settings UIs and validation). */
export type IndicatorParam = NumberParam | SourceParam | ChoiceParam;

/** A resolved indicator config value. */
export type IndicatorConfigValue = number | string;

/** Unvalidated indicator config as supplied by the host. */
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

/** One of the param's options (default otherwise). */
export function resolveChoiceParam<T extends string>(
  raw: RawIndicatorConfig | null | undefined,
  param: ChoiceParam & { readonly options: readonly T[]; readonly default: T }
): T {
  const value = raw?.[param.key];
  const options: readonly T[] = param.options;
  return options.find((o) => o === value) ?? param.default;
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

/** Integer `period` param descriptor (1 … `MAX_INDICATOR_PERIOD`). */
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

/** `source` param descriptor (`PRICE_SOURCES`). */
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
 * in schema order, plus the source / choice when it differs from the
 * default (`EMA 20`, `BB 20 2`, `SMA 50 hl2`).
 */
export function formatIndicatorLabel(
  shortName: string,
  params: readonly IndicatorParam[],
  config: Readonly<Record<string, unknown>>
): string {
  let label = shortName;
  for (const p of params) {
    const value = config[p.key];
    if (p.kind === 'source' || p.kind === 'choice') {
      if (value !== p.default && typeof value === 'string') {
        label += ' ' + value;
      }
    } else if (typeof value === 'number') {
      label += ' ' + String(value);
    }
  }
  return label;
}
