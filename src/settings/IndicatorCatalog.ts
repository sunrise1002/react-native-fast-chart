import type { IndicatorInput } from '../indicators/Indicator';
import type {
  IndicatorConfigValue,
  IndicatorParam,
} from '../indicators/IndicatorConfig';
import type {
  IndicatorMeta,
  IndicatorPlacement,
  IndicatorRegistry,
} from '../indicators/IndicatorRegistry';
import { PRICE_PANE_ID } from '../panes/Pane';

/*
 * Headless helpers for an "Indicators" settings UI (spec Phase 14.2–14.5).
 * The library ships no modal / bottom sheet: hosts render their own UI
 * from the registry schemas (`IndicatorMeta.params`) and these helpers.
 */

/** Placements an indicator type supports, default first. */
export function allowedPlacements(
  meta: IndicatorMeta
): readonly IndicatorPlacement[] {
  // Price-scaled overlays (MA, bands) only make sense on the price pane;
  // pane indicators may also sit on it with their own scale (volume).
  return meta.placement === 'overlay' ? ['overlay'] : ['pane', 'overlay'];
}

/** Current placement of an indicator from its pane id. */
export function placementOf(paneId: string): IndicatorPlacement {
  return paneId === PRICE_PANE_ID ? 'overlay' : 'pane';
}

/** Options of `createIndicatorInput`. */
export interface CreateIndicatorOptions {
  /** Defaults to the type's placement; unsupported placements fall back. */
  placement?: IndicatorPlacement;
  config?: Readonly<Record<string, unknown>>;
  id?: string;
}

/**
 * Input for `addIndicator` with the appropriate defaults (spec 14.5):
 * overlays go to the price pane, pane indicators get their own automatic
 * pane unless `placement: 'overlay'` is chosen. Throws on an unknown type.
 */
export function createIndicatorInput(
  registry: IndicatorRegistry,
  type: string,
  options: CreateIndicatorOptions = {}
): IndicatorInput {
  const module = registry.get(type);
  if (!module) {
    throw new Error(`Unknown indicator type "${type}"`);
  }
  const allowed = allowedPlacements(module.meta);
  const placement =
    options.placement !== undefined && allowed.includes(options.placement)
      ? options.placement
      : (allowed[0] as IndicatorPlacement);
  const input: IndicatorInput = { type, config: { ...options.config } };
  if (options.id !== undefined) {
    input.id = options.id;
  }
  if (placement === 'overlay') {
    input.paneId = PRICE_PANE_ID;
  }
  return input;
}

/** Result of parsing a form field for one param. */
export interface ParsedParamValue {
  /** Resolved value (clamped / rounded / defaulted). */
  value: IndicatorConfigValue;
  /** `false` when the text was not a usable value (default used). */
  valid: boolean;
  /** `true` when a number had to be clamped or rounded. */
  adjusted: boolean;
}

/**
 * Parses a text field (or picker value) for `param` the way the engine
 * will resolve it, so the form can show the effective value and flag
 * invalid input before calling `updateIndicator`.
 */
export function parseParamValue(
  param: IndicatorParam,
  input: string | number
): ParsedParamValue {
  if (param.kind === 'source' || param.kind === 'choice') {
    const options: readonly string[] = param.options;
    const match = options.find((o) => o === input);
    return match !== undefined
      ? { value: match, valid: true, adjusted: false }
      : { value: param.default, valid: false, adjusted: false };
  }
  const text = typeof input === 'string' ? input.trim() : '';
  const raw =
    typeof input === 'number' ? input : text === '' ? NaN : Number(text);
  if (!Number.isFinite(raw)) {
    return { value: param.default, valid: false, adjusted: false };
  }
  const rounded = param.kind === 'integer' ? Math.round(raw) : raw;
  const value = Math.min(param.max, Math.max(param.min, rounded));
  return { value, valid: true, adjusted: value !== raw };
}
