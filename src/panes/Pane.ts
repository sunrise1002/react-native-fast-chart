export type PaneType = 'price' | 'indicator';

/** Id of the main price pane, which always exists and is always first. */
export const PRICE_PANE_ID = 'price';

/** Serializable pane layout description (spec §12.1). */
export interface PaneDefinition {
  id: string;
  type: PaneType;
  /** Relative height weight among all panes (> 0). */
  heightRatio: number;
  /** Minimum height in dp. */
  minHeight: number;
  /** Indicators drawn in the pane, in display order. */
  indicatorIds: string[];
}

/** Loose input of `addPane` (everything optional). */
export interface PaneInput {
  /** Generated (`pane-N`) when omitted. */
  id?: string;
  heightRatio?: number;
  minHeight?: number;
  /** Insert position (clamped behind the price pane); default: last. */
  index?: number;
}

/** Default weights: one indicator pane gets 1/4 of the price pane's height. */
export const DEFAULT_PRICE_PANE_RATIO = 3;
export const DEFAULT_INDICATOR_PANE_RATIO = 1;
export const DEFAULT_PRICE_PANE_MIN_HEIGHT = 80;
export const DEFAULT_INDICATOR_PANE_MIN_HEIGHT = 40;
/** Height ratios are clamped into this range. */
export const MIN_PANE_RATIO = 1e-3;
export const MAX_PANE_RATIO = 1e3;

/** Valid ratio (clamped) or `fallback` for non-finite / non-positive input. */
export function sanitizePaneRatio(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !(value > 0) || value === Infinity) {
    return fallback;
  }
  return value < MIN_PANE_RATIO
    ? MIN_PANE_RATIO
    : value > MAX_PANE_RATIO
      ? MAX_PANE_RATIO
      : value;
}

/** Valid minimum height (`>= 0`, finite) or `fallback`. */
export function sanitizePaneMinHeight(
  value: unknown,
  fallback: number
): number {
  return typeof value === 'number' && value >= 0 && value < Infinity
    ? value
    : fallback;
}

/** The price pane with default sizing. */
export function createPricePane(): PaneDefinition {
  return {
    id: PRICE_PANE_ID,
    type: 'price',
    heightRatio: DEFAULT_PRICE_PANE_RATIO,
    minHeight: DEFAULT_PRICE_PANE_MIN_HEIGHT,
    indicatorIds: [],
  };
}
