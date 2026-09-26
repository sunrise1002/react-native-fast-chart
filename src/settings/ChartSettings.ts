import type {
  HistogramColorMode,
  IndicatorDefinition,
  IndicatorInput,
  IndicatorStyle,
} from '../indicators/Indicator';
import type { PaneDefinition } from '../panes/Pane';
import { PRICE_PANE_ID } from '../panes/Pane';

/*
 * Serializable user chart settings (spec §25, Phase 14.1): indicator list
 * with params and styles, pane order and heights, theme name and last
 * timeframe. Candle data is never part of it. The library has no storage
 * dependency: hosts persist the `serializeChartSettings` string wherever
 * they like (AsyncStorage, MMKV, a server) and restore it with
 * `deserializeChartSettings`, which never throws — a corrupt or foreign
 * payload yields defaults plus a list of issues.
 */

export const CHART_SETTINGS_VERSION = 1;

/** Plain config values that survive JSON. */
export type IndicatorSettingValue = number | string | boolean;

export interface IndicatorSettings {
  id: string;
  type: string;
  paneId: string;
  config: Record<string, IndicatorSettingValue>;
  style: Partial<IndicatorStyle>;
}

export interface PaneSettings {
  id: string;
  heightRatio: number;
  minHeight: number;
  /** Created explicitly (kept when empty) rather than by an indicator. */
  explicit: boolean;
}

export interface ChartSettings {
  version: typeof CHART_SETTINGS_VERSION;
  /** Display order. */
  indicators: IndicatorSettings[];
  /** Display order, price pane first. */
  panes: PaneSettings[];
  /** Host-defined theme name (e.g. `'dark'`). */
  theme?: string;
  /** Last selected timeframe (e.g. `'1m'`). */
  timeframe?: string;
}

export interface ChartSettingsIssue {
  /** JSON-path-like location, e.g. `indicators[2].type`. */
  path: string;
  reason: string;
}

export interface DeserializedChartSettings {
  settings: ChartSettings;
  issues: ChartSettingsIssue[];
}

export function defaultChartSettings(): ChartSettings {
  return { version: CHART_SETTINGS_VERSION, indicators: [], panes: [] };
}

export interface ChartSettingsSource {
  indicators: readonly { readonly definition: IndicatorDefinition }[];
  panes: readonly PaneDefinition[];
  /** Pane created by `addPane` (defaults to "not explicit"). */
  isExplicitPane?: (id: string) => boolean;
  theme?: string;
  timeframe?: string;
}

/** Snapshot of the current chart configuration as plain data. */
export function createChartSettings(
  source: ChartSettingsSource
): ChartSettings {
  const settings: ChartSettings = {
    version: CHART_SETTINGS_VERSION,
    indicators: source.indicators.map(({ definition }) => ({
      id: definition.id,
      type: definition.type,
      paneId: definition.paneId,
      config: sanitizeConfig(definition.config, '', []),
      style: sanitizeStyle(definition.style, '', []),
    })),
    panes: source.panes.map((pane) => ({
      id: pane.id,
      heightRatio: pane.heightRatio,
      minHeight: pane.minHeight,
      explicit:
        pane.id === PRICE_PANE_ID ||
        (source.isExplicitPane?.(pane.id) ?? false),
    })),
  };
  if (source.theme !== undefined) {
    settings.theme = source.theme;
  }
  if (source.timeframe !== undefined) {
    settings.timeframe = source.timeframe;
  }
  return settings;
}

export function serializeChartSettings(settings: ChartSettings): string {
  return JSON.stringify(settings);
}

/** Indicator inputs of `settings` (for `setIndicators`). */
export function settingsToIndicatorInputs(
  settings: ChartSettings
): IndicatorInput[] {
  return settings.indicators.map((s) => ({
    id: s.id,
    type: s.type,
    paneId: s.paneId,
    config: { ...s.config },
    style: { ...s.style },
  }));
}

/**
 * Parses and validates persisted settings (JSON string or parsed value).
 * Tolerant: invalid entries are dropped one by one and reported; an
 * unparsable payload or a newer, unknown `version` yields the defaults.
 * `isKnownType` drops indicators whose type is not registered.
 */
export function deserializeChartSettings(
  input: unknown,
  isKnownType?: (type: string) => boolean
): DeserializedChartSettings {
  const issues: ChartSettingsIssue[] = [];
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      issues.push({ path: '', reason: 'invalid JSON' });
      return { settings: defaultChartSettings(), issues };
    }
  }
  if (!isRecord(raw)) {
    issues.push({ path: '', reason: 'not an object' });
    return { settings: defaultChartSettings(), issues };
  }
  const version = raw.version;
  if (version !== CHART_SETTINGS_VERSION) {
    issues.push({
      path: 'version',
      reason:
        typeof version === 'number' && version > CHART_SETTINGS_VERSION
          ? `unsupported version ${version}`
          : 'missing or invalid version',
    });
    return { settings: defaultChartSettings(), issues };
  }
  const settings = defaultChartSettings();
  settings.indicators = readIndicators(raw.indicators, isKnownType, issues);
  settings.panes = readPanes(raw.panes, issues);
  readName(raw, 'theme', settings, issues);
  readName(raw, 'timeframe', settings, issues);
  return { settings, issues };
}

/* --------------------------------- Readers --------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function readList(
  value: unknown,
  path: string,
  issues: ChartSettingsIssue[]
): unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push({ path, reason: 'not an array' });
    return [];
  }
  return value;
}

function readIndicators(
  value: unknown,
  isKnownType: ((type: string) => boolean) | undefined,
  issues: ChartSettingsIssue[]
): IndicatorSettings[] {
  const out: IndicatorSettings[] = [];
  const seen = new Set<string>();
  readList(value, 'indicators', issues).forEach((item, i) => {
    const path = `indicators[${i}]`;
    if (!isRecord(item)) {
      issues.push({ path, reason: 'not an object' });
      return;
    }
    const { id, type, paneId } = item;
    if (!isNonEmptyString(id) || seen.has(id)) {
      issues.push({ path: `${path}.id`, reason: 'missing or duplicate id' });
      return;
    }
    if (!isNonEmptyString(type) || (isKnownType && !isKnownType(type))) {
      issues.push({ path: `${path}.type`, reason: 'unknown indicator type' });
      return;
    }
    if (!isNonEmptyString(paneId)) {
      issues.push({ path: `${path}.paneId`, reason: 'missing pane id' });
      return;
    }
    seen.add(id);
    out.push({
      id,
      type,
      paneId,
      config: sanitizeConfig(item.config, `${path}.config`, issues),
      style: sanitizeStyle(item.style, `${path}.style`, issues),
    });
  });
  return out;
}

function readPanes(
  value: unknown,
  issues: ChartSettingsIssue[]
): PaneSettings[] {
  const out: PaneSettings[] = [];
  const seen = new Set<string>();
  readList(value, 'panes', issues).forEach((item, i) => {
    const path = `panes[${i}]`;
    if (!isRecord(item) || !isNonEmptyString(item.id) || seen.has(item.id)) {
      issues.push({ path, reason: 'invalid or duplicate pane' });
      return;
    }
    const { heightRatio, minHeight } = item;
    if (!isPositiveFinite(heightRatio)) {
      issues.push({ path: `${path}.heightRatio`, reason: 'invalid ratio' });
      return;
    }
    seen.add(item.id);
    out.push({
      id: item.id,
      heightRatio,
      minHeight:
        typeof minHeight === 'number' && minHeight >= 0 && minHeight < Infinity
          ? minHeight
          : 0,
      explicit: item.id === PRICE_PANE_ID || item.explicit === true,
    });
  });
  return out;
}

function readName(
  raw: Record<string, unknown>,
  key: 'theme' | 'timeframe',
  settings: ChartSettings,
  issues: ChartSettingsIssue[]
): void {
  const value = raw[key];
  if (isNonEmptyString(value)) {
    settings[key] = value;
  } else if (value !== undefined) {
    issues.push({ path: key, reason: 'not a string' });
  }
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && value < Infinity;
}

function isSettingValue(value: unknown): value is IndicatorSettingValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function sanitizeConfig(
  value: unknown,
  path: string,
  issues: ChartSettingsIssue[]
): Record<string, IndicatorSettingValue> {
  const out: Record<string, IndicatorSettingValue> = {};
  if (!isRecord(value)) {
    if (value !== undefined) {
      issues.push({ path, reason: 'not an object' });
    }
    return out;
  }
  for (const [key, v] of Object.entries(value)) {
    if (isSettingValue(v)) {
      out[key] = v;
    } else {
      issues.push({ path: `${path}.${key}`, reason: 'unsupported value' });
    }
  }
  return out;
}

const COLOR_MODES: readonly HistogramColorMode[] = ['sign', 'trend', 'candle'];

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

function sanitizeStyle(
  value: unknown,
  path: string,
  issues: ChartSettingsIssue[]
): Partial<IndicatorStyle> {
  const out: Partial<IndicatorStyle> = {};
  if (!isRecord(value)) {
    if (value !== undefined) {
      issues.push({ path, reason: 'not an object' });
    }
    return out;
  }
  const bad = (key: string) =>
    issues.push({ path: `${path}.${key}`, reason: 'invalid value' });
  const { visible, lineWidth, opacity, colors, fill, fillOpacity } = value;
  const { histogramColorMode } = value;
  if (typeof visible === 'boolean') out.visible = visible;
  else if (visible !== undefined) bad('visible');
  if (isPositiveFinite(lineWidth)) out.lineWidth = lineWidth;
  else if (lineWidth !== undefined) bad('lineWidth');
  if (isUnit(opacity)) out.opacity = opacity;
  else if (opacity !== undefined) bad('opacity');
  if (typeof fill === 'boolean') out.fill = fill;
  else if (fill !== undefined) bad('fill');
  if (isUnit(fillOpacity)) out.fillOpacity = fillOpacity;
  else if (fillOpacity !== undefined) bad('fillOpacity');
  if (Array.isArray(colors) && colors.every((c) => typeof c === 'string')) {
    out.colors = [...(colors as string[])];
  } else if (colors !== undefined) bad('colors');
  if (COLOR_MODES.includes(histogramColorMode as HistogramColorMode)) {
    out.histogramColorMode = histogramColorMode as HistogramColorMode;
  } else if (histogramColorMode !== undefined) bad('histogramColorMode');
  return out;
}
