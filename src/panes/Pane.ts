export type PaneType = 'price' | 'indicator';

/** Id of the main price pane, which always exists. */
export const PRICE_PANE_ID = 'price';

/** Serializable pane layout description (spec §12.1). Implemented in P6. */
export interface PaneDefinition {
  id: string;
  type: PaneType;
  /** Relative height weight among all panes (> 0). */
  heightRatio: number;
  /** Minimum height in dp. */
  minHeight: number;
  indicatorIds: string[];
}
