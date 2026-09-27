import type { ColorValue } from '../theme/ChartTheme';

/*
 * Public input types of the trading overlays (spec Phase 22): price lines,
 * orders, fills, the position with TP / SL, annotations. Plain data; the
 * `TradingOverlayStore` validates and normalizes them. Colors default to
 * the theme's `trading` section when omitted.
 */

/** Stroke pattern of an overlay line. */
export type OverlayLineStyle = 'solid' | 'dashed' | 'dotted';

/** Order / fill side. */
export type TradeSide = 'buy' | 'sell';

/** Position direction. */
export type PositionSide = 'long' | 'short';

/** Horizontal price line (the primitive every level is drawn with). */
export interface PriceLineInput {
  /** Stable id; generated when omitted. */
  id?: string;
  price: number;
  /** Line, label box and axis badge color (default `theme.trading.priceLine`). */
  color?: ColorValue;
  /** Line width, dp (default 1). */
  lineWidth?: number;
  /** Default `'dashed'`. */
  lineStyle?: OverlayLineStyle;
  /** Text of the in-plot label box (left side); empty = no box. */
  label?: string;
  /** Price badge on the price axis (default `true`). */
  axisLabel?: boolean;
  /** Can be dragged vertically; snaps to the symbol tick size. */
  draggable?: boolean;
  /** Default `true`. */
  visible?: boolean;
}

/** Patch of `updatePriceLine` (omitted fields are kept). */
export type PriceLinePatch = Partial<Omit<PriceLineInput, 'id'>>;

/** A price line as stored (every field resolved). */
export interface PriceLine {
  id: string;
  price: number;
  /** `''` = theme default. */
  color: ColorValue;
  lineWidth: number;
  lineStyle: OverlayLineStyle;
  label: string;
  axisLabel: boolean;
  draggable: boolean;
  visible: boolean;
}

/** Open (working) order, drawn as a labelled price line (spec 22.1). */
export interface OrderInput {
  id: string;
  side: TradeSide;
  price: number;
  quantity: number;
  /** Order type shown in the label (default `'Limit'`). */
  type?: string;
  /** Price can be dragged (order modification); default `false`. */
  draggable?: boolean;
  /** Overrides the side color. */
  color?: ColorValue;
}

/** Filled order, drawn as a marker on the bar it filled in (spec 22.1). */
export interface FillInput {
  id: string;
  side: TradeSide;
  /** Fill time, epoch ms (placed on the bar that contains it). */
  time: number;
  price: number;
  quantity?: number;
  /** `'arrow'` (default) or `'circle'`. */
  shape?: 'arrow' | 'circle';
  color?: ColorValue;
}

/** Open position with optional TP / SL (spec 22.2 / 22.3). */
export interface PositionInput {
  /** Default `'position'`. Reported in drag events of TP / SL. */
  id?: string;
  side: PositionSide;
  /** Absolute size (base units / contracts), `> 0`. */
  size: number;
  /** Average entry price. */
  entryPrice: number;
  /** Liquidation price line (omit / `null` = none). */
  liquidationPrice?: number | null;
  takeProfit?: number | null;
  stopLoss?: number | null;
  /** TP / SL can be dragged (default `true`). */
  tpSlDraggable?: boolean;
  /** PnL per price unit per size unit (contract multiplier), default 1. */
  multiplier?: number;
  /** Shade between the entry and the last price (default `true`). */
  showPnlArea?: boolean;
}

/** Where a time-anchored marker sits relative to its bar. */
export type MarkerPosition = 'above' | 'below' | 'price';

/** Marker glyph. */
export type MarkerShape =
  'arrowUp' | 'arrowDown' | 'circle' | 'square' | 'diamond';

/** Generic annotations (spec 22.4). */
export type AnnotationInput =
  | {
      type: 'horizontalLine';
      id: string;
      price: number;
      color?: ColorValue;
      lineStyle?: OverlayLineStyle;
      label?: string;
    }
  | {
      type: 'verticalLine';
      id: string;
      /** Epoch ms; drawn at the bar containing it (or extrapolated). */
      time: number;
      color?: ColorValue;
      lineStyle?: OverlayLineStyle;
      label?: string;
    }
  | {
      type: 'note';
      id: string;
      time: number;
      price: number;
      text: string;
      color?: ColorValue;
    }
  | {
      type: 'marker';
      id: string;
      time: number;
      /** Default `'above'`. `'price'` needs `price`. */
      position?: MarkerPosition;
      price?: number;
      shape?: MarkerShape;
      /** Short text: one or two characters drawn inside (e.g. `'N'`). */
      icon?: string;
      /** Text drawn next to the marker. */
      text?: string;
      color?: ColorValue;
    };

/** What a line drag belongs to (see `OverlayDragEvent`). */
export type OverlayDragTarget =
  'priceLine' | 'order' | 'takeProfit' | 'stopLoss';

/**
 * Drag of a draggable level (TP / SL, draggable orders and price lines).
 * `'change'` fires when the snapped price changes during the drag (at
 * most once per tick step), `'commit'` once on release. The chart applies
 * the committed price to its own copy; hosts mirror it in their state.
 */
export interface OverlayDragEvent {
  phase: 'change' | 'commit';
  target: OverlayDragTarget;
  /** Price line / order / position id. */
  id: string;
  price: number;
}

export type OverlayDragHandler = (event: OverlayDragEvent) => void;
