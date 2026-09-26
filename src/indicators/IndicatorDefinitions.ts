import { PRICE_PANE_ID } from '../panes/Pane';
import type {
  IndicatorDefinition,
  IndicatorInput,
  IndicatorStyle,
} from './Indicator';
import type {
  IndicatorGuides,
  IndicatorMeta,
  IndicatorModule,
} from './IndicatorRegistry';

/**
 * Active indicator instance as exposed to React / renderers: the
 * normalized definition (resolved config), its type metadata and the
 * legend label. Immutable snapshot; replaced when anything changes.
 */
export interface IndicatorEntry {
  readonly id: string;
  readonly definition: IndicatorDefinition;
  readonly meta: IndicatorMeta;
  readonly label: string;
  /** Guide levels for the resolved config (pane indicators). */
  readonly guides?: IndicatorGuides;
  /**
   * Display shift per output column in bars (`IndicatorModule.
   * outputOffsets`); omitted when no output is shifted.
   */
  readonly offsets?: readonly number[];
}

export const DEFAULT_INDICATOR_STYLE: Readonly<IndicatorStyle> = Object.freeze({
  visible: true,
});

/** Pane id used for `'pane'` placement until the P6 pane manager exists. */
export function defaultPaneId(meta: IndicatorMeta, id: string): string {
  return meta.placement === 'overlay' ? PRICE_PANE_ID : `pane:${id}`;
}

/**
 * Normalizes a loose input into a definition: resolved config (defaults
 * applied, values clamped), default pane from the placement, style merged
 * over the defaults.
 */
export function normalizeIndicator(
  module: IndicatorModule,
  input: IndicatorInput,
  id: string,
  previous?: IndicatorDefinition
): IndicatorDefinition {
  const config = module.resolveConfig({
    ...previous?.config,
    ...input.config,
  });
  return {
    id,
    type: module.meta.type,
    paneId: input.paneId ?? previous?.paneId ?? defaultPaneId(module.meta, id),
    config: Object.freeze({ ...(config as object) }),
    style: {
      ...DEFAULT_INDICATOR_STYLE,
      ...previous?.style,
      ...input.style,
    },
  };
}

/** Structural equality of two resolved configs (flat numbers / strings). */
export function sameConfig(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  return keys.every((k) => Object.is(a[k], b[k]));
}

/** Entry + resolved config for an input (optionally patching `previous`). */
export function createIndicatorEntry(
  module: IndicatorModule,
  input: IndicatorInput,
  id: string,
  previous?: IndicatorEntry
): { entry: IndicatorEntry; config: unknown } {
  const definition = normalizeIndicator(
    module,
    input,
    id,
    previous?.definition
  );
  const config = module.resolveConfig(definition.config);
  const label = module.formatLabel(config);
  const entry: {
    -readonly [K in keyof IndicatorEntry]: IndicatorEntry[K];
  } = { id, definition, meta: module.meta, label };
  if (module.guides) {
    entry.guides = module.guides(config);
  }
  const offsets = module.outputOffsets?.(config);
  if (offsets?.some((o) => o !== 0)) {
    entry.offsets = offsets.map((o) =>
      Number.isFinite(o) ? Math.round(o) : 0
    );
  }
  return { entry, config };
}
