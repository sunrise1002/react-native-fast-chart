import { isPlainObject } from '../utils/deepMerge';
import type { ChartConfig } from './ChartConfig';

type Section = Record<string, unknown>;

/** Numeric options that must also be `> 0` (a zero would divide / hide). */
const POSITIVE_FIELDS: ReadonlySet<string> = new Set([
  'viewport.initialBarSpacing',
  'viewport.maxBarSpacing',
  'viewport.minBarSpacing',
  'layout.overlayScaleHeightRatio',
  'telemetry.performanceSampleMs',
]);

/** Numeric options capped at 1 (ratios). */
const UNIT_FIELDS: ReadonlySet<string> = new Set([
  'viewport.bodyRatio',
  'layout.overlayScaleHeightRatio',
]);

/** Enumerated string options and their allowed values. */
const ENUM_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'crosshair.mode': ['hold', 'sticky'],
  'axes.dailyBarsTimeZone': ['utc', 'chart'],
};

function validNumber(path: string, value: unknown): boolean {
  if (typeof value !== 'number' || !(value >= 0 && value < Infinity)) {
    return false;
  }
  if (POSITIVE_FIELDS.has(path) && value === 0) {
    return false;
  }
  return !(UNIT_FIELDS.has(path) && value > 1);
}

function validField(path: string, value: unknown, fallback: unknown): boolean {
  if (fallback === null) {
    // Symbol metadata (`number | null`): invalid numbers are ignored later.
    return value === null || typeof value === 'number';
  }
  if (path === 'axes.timeZone') {
    return (
      (typeof value === 'string' && value !== '') ||
      (typeof value === 'number' && Number.isFinite(value))
    );
  }
  const allowed = ENUM_FIELDS[path];
  if (allowed !== undefined) {
    return typeof value === 'string' && allowed.includes(value);
  }
  if (typeof fallback === 'number') {
    return validNumber(path, value);
  }
  return typeof value === typeof fallback;
}

/**
 * Replaces invalid options of a resolved config with their defaults
 * (spec Phase 20.2: bad input never reaches the engine or Skia): wrong
 * types, `NaN` / ±∞ / negative numbers, zero spacings, ratios above 1 and
 * unknown enum values. The zoom limits are kept ordered
 * (`min <= initial <= max`). Valid sections are returned as-is.
 */
export function sanitizeChartConfig(
  config: ChartConfig,
  defaults: Readonly<ChartConfig>
): ChartConfig {
  const out = { ...config } as Record<string, unknown>;
  const base = defaults as unknown as Record<string, Section>;
  for (const name of Object.keys(base)) {
    const fallback = base[name] as Section;
    const current = out[name];
    if (!isPlainObject(current)) {
      out[name] = fallback;
      continue;
    }
    let fixed: Section | null = null;
    for (const key of Object.keys(fallback)) {
      if (!validField(`${name}.${key}`, current[key], fallback[key])) {
        fixed ??= { ...current };
        fixed[key] = fallback[key];
      }
    }
    if (fixed !== null) {
      out[name] = fixed;
    }
  }
  const result = out as unknown as ChartConfig;
  const { minBarSpacing, maxBarSpacing, initialBarSpacing } = result.viewport;
  if (minBarSpacing > maxBarSpacing) {
    result.viewport = {
      ...result.viewport,
      minBarSpacing: defaults.viewport.minBarSpacing,
      maxBarSpacing: defaults.viewport.maxBarSpacing,
    };
  }
  const { minBarSpacing: lo, maxBarSpacing: hi } = result.viewport;
  if (initialBarSpacing < lo || initialBarSpacing > hi) {
    result.viewport = {
      ...result.viewport,
      initialBarSpacing: Math.min(hi, Math.max(lo, initialBarSpacing)),
    };
  }
  return result;
}
