import type {
  Drawing,
  DrawingInput,
  DrawingPatch,
  DrawingType,
} from '../trading/DrawingModel';
import type {
  AnnotationInput,
  FillInput,
  OrderInput,
  OverlayDragHandler,
  PositionInput,
  PriceLine,
  PriceLineInput,
  PriceLinePatch,
} from '../trading/TradingTypes';

/**
 * Trading overlays and drawings part of the controller (spec Phase 22).
 * All calls run on the JS thread and never re-render React; the chart
 * mirrors the overlays into one UI-thread snapshot per call. List setters
 * replace the whole list and drop invalid / duplicate entries (they
 * return the accepted count).
 */
export interface TradingOverlayController {
  /* ------------------------------ Price lines ------------------------------ */

  /**
   * Adds a horizontal price line (line + axis badge + optional label).
   * Returns its id. Throws on a non-finite price or a duplicate id.
   */
  addPriceLine(line: PriceLineInput): string;
  /** `false` for an unknown id or a non-finite price. */
  updatePriceLine(id: string, patch: PriceLinePatch): boolean;
  removePriceLine(id: string): boolean;
  getPriceLines(): PriceLine[];

  /* ------------------------ Orders / fills / position ------------------------ */

  /** Open orders, drawn as labelled lines. */
  setOrders(orders: readonly OrderInput[]): number;
  getOrders(): OrderInput[];
  /** Filled orders, drawn as markers on their bars. */
  setFills(fills: readonly FillInput[]): number;
  getFills(): FillInput[];
  /**
   * Position overlay: entry line with live PnL, PnL area, liquidation
   * line and draggable TP / SL. `null` clears; `false` when invalid.
   */
  setPosition(position: PositionInput | null): boolean;
  getPosition(): PositionInput | null;
  /** Horizontal / vertical lines, notes and time-anchored markers. */
  setAnnotations(annotations: readonly AnnotationInput[]): number;
  getAnnotations(): AnnotationInput[];
  /** Clears price lines, orders, fills, position and annotations. */
  clearOverlays(): void;
  /**
   * Level drags (TP / SL, draggable orders / price lines): `'change'`
   * per tick step while dragging, `'commit'` on release.
   */
  subscribeOverlayDrag(listener: OverlayDragHandler): () => void;

  /* -------------------------------- Drawings -------------------------------- */

  /**
   * Activates a drawing tool: the next taps on the chart place its anchors
   * (tap-tap). `null` turns drawing mode off. `false` for unknown tools.
   */
  setDrawingTool(tool: DrawingType | null): boolean;
  getDrawingTool(): DrawingType | null;
  /** Throws on an invalid type / anchors or a duplicate id. */
  addDrawing(drawing: DrawingInput): string;
  updateDrawing(id: string, patch: DrawingPatch): boolean;
  removeDrawing(id: string): boolean;
  /** Replaces every drawing (e.g. restored for a symbol). */
  setDrawings(drawings: readonly DrawingInput[]): number;
  /** Copies, in z-order (last on top). Serializable. */
  getDrawings(): Drawing[];
  /** Selects a drawing (move / edit its anchors); `null` clears. */
  selectDrawing(id: string | null): boolean;
  getSelectedDrawingId(): string | null;
  /** Drawings, the tool or the selection changed (e.g. autosave). */
  subscribeDrawings(listener: () => void): () => void;
}
