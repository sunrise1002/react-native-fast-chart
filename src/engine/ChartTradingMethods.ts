import type { TradingOverlayController } from '../core/TradingController';
import type {
  Drawing,
  DrawingInput,
  DrawingPatch,
  DrawingType,
} from '../trading/DrawingModel';
import { TradingOverlayStore } from '../trading/TradingOverlayStore';
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
 * Trading overlay half of the controller: delegations to the
 * `TradingOverlayStore` (kept apart so `ChartController` stays small).
 */
export class ChartTradingMethods implements TradingOverlayController {
  /** Trading overlays and drawings (JS-thread source of truth). */
  readonly trading = new TradingOverlayStore();

  addPriceLine(line: PriceLineInput): string {
    return this.trading.addPriceLine(line);
  }

  updatePriceLine(id: string, patch: PriceLinePatch): boolean {
    return this.trading.updatePriceLine(id, patch);
  }

  removePriceLine(id: string): boolean {
    return this.trading.removePriceLine(id);
  }

  getPriceLines(): PriceLine[] {
    return this.trading.getPriceLines();
  }

  setOrders(orders: readonly OrderInput[]): number {
    return this.trading.setOrders(orders);
  }

  getOrders(): OrderInput[] {
    return this.trading.getOrders();
  }

  setFills(fills: readonly FillInput[]): number {
    return this.trading.setFills(fills);
  }

  getFills(): FillInput[] {
    return this.trading.getFills();
  }

  setPosition(position: PositionInput | null): boolean {
    return this.trading.setPosition(position);
  }

  getPosition(): PositionInput | null {
    return this.trading.getPosition();
  }

  setAnnotations(annotations: readonly AnnotationInput[]): number {
    return this.trading.setAnnotations(annotations);
  }

  getAnnotations(): AnnotationInput[] {
    return this.trading.getAnnotations();
  }

  clearOverlays(): void {
    this.trading.clearOverlays();
  }

  subscribeOverlayDrag(listener: OverlayDragHandler): () => void {
    return this.trading.subscribeDrag(listener);
  }

  setDrawingTool(tool: DrawingType | null): boolean {
    return this.trading.drawings.setTool(tool);
  }

  getDrawingTool(): DrawingType | null {
    const tool = this.trading.drawings.activeTool;
    return tool === '' ? null : tool;
  }

  addDrawing(drawing: DrawingInput): string {
    return this.trading.drawings.add(drawing);
  }

  updateDrawing(id: string, patch: DrawingPatch): boolean {
    return this.trading.drawings.update(id, patch);
  }

  removeDrawing(id: string): boolean {
    return this.trading.drawings.remove(id);
  }

  setDrawings(drawings: readonly DrawingInput[]): number {
    return this.trading.drawings.setAll(drawings);
  }

  getDrawings(): Drawing[] {
    return this.trading.drawings.getAll();
  }

  selectDrawing(id: string | null): boolean {
    return this.trading.drawings.select(id);
  }

  getSelectedDrawingId(): string | null {
    const id = this.trading.drawings.selectedId;
    return id === '' ? null : id;
  }

  subscribeDrawings(listener: () => void): () => void {
    return this.trading.subscribeDrawings(listener);
  }
}
