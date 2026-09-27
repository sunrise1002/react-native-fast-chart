import { ListenerSet } from '../utils/ListenerSet';
import { DrawingCollection } from './DrawingCollection';
import type { DrawingType } from './DrawingModel';
import { emptyOverlayScene, type OverlayScene } from './OverlayScene';
import {
  filterUnique,
  isValidAnnotation,
  isValidFill,
  isValidOrder,
  normalizePosition,
  resolvePriceLine,
} from './OverlayValidation';
import { compileOverlayScene } from './SceneCompiler';
import type {
  AnnotationInput,
  FillInput,
  OrderInput,
  OverlayDragEvent,
  OverlayDragTarget,
  PositionInput,
  PriceLine,
  PriceLineInput,
  PriceLinePatch,
} from './TradingTypes';

/**
 * JS-thread source of truth of the trading overlays: price lines, open
 * orders, fills, the position (entry / liquidation / TP / SL),
 * annotations and drawings. Every effective change recompiles the UI
 * scene once and notifies `subscribeScene` (the chart mirrors it into a
 * shared value). Line drags reported by the UI thread are applied here
 * and fanned out to `subscribeDrag`. Pure TypeScript.
 */
export class TradingOverlayStore {
  readonly drawings: DrawingCollection;
  private priceLines: PriceLine[] = [];
  private orders: OrderInput[] = [];
  private fills: FillInput[] = [];
  private position: PositionInput | null = null;
  private annotations: AnnotationInput[] = [];
  private quantityDecimals = NaN;
  private keepTool = false;
  private version = 0;
  private scene: OverlayScene = emptyOverlayScene();
  private nextLineId = 1;
  private readonly sceneListeners = new ListenerSet<[OverlayScene]>();
  private readonly drawingListeners = new ListenerSet<[]>();
  private readonly dragListeners = new ListenerSet<[OverlayDragEvent]>();

  constructor() {
    this.drawings = new DrawingCollection(() => {
      this.commit();
      this.drawingListeners.emit();
    });
  }

  /** Quantity decimals of order labels and the draft tool policy. */
  configure(quantityDecimals: number, keepDrawingTool: boolean): void {
    this.keepTool = keepDrawingTool;
    const next =
      quantityDecimals >= 0 && quantityDecimals < Infinity
        ? quantityDecimals
        : NaN;
    if (!Object.is(next, this.quantityDecimals)) {
      this.quantityDecimals = next;
      this.commit();
    }
  }

  private commit(): void {
    this.version += 1;
    this.scene = compileOverlayScene(
      {
        priceLines: this.priceLines,
        orders: this.orders,
        fills: this.fills,
        position: this.position,
        annotations: this.annotations,
        drawings: this.drawings.items,
        tool: this.drawings.activeTool,
        selectedId: this.drawings.selectedId,
        quantityDecimals: this.quantityDecimals,
      },
      this.version
    );
    this.sceneListeners.emit(this.scene);
  }

  getScene(): OverlayScene {
    return this.scene;
  }

  subscribeScene(listener: (scene: OverlayScene) => void): () => void {
    return this.sceneListeners.add(listener);
  }

  /** Drawing list, tool or selection changed. */
  subscribeDrawings(listener: () => void): () => void {
    return this.drawingListeners.add(listener);
  }

  subscribeDrag(listener: (event: OverlayDragEvent) => void): () => void {
    return this.dragListeners.add(listener);
  }

  /* ------------------------------ Price lines ------------------------------ */

  /** Throws on a non-finite price or a duplicate id. */
  addPriceLine(input: PriceLineInput): string {
    let id = input.id;
    if (id === undefined) {
      do {
        id = `price-line-${this.nextLineId++}`;
      } while (this.priceLines.some((p) => p.id === id));
    }
    if (typeof id !== 'string' || id === '') {
      throw new Error('Invalid price line id');
    }
    if (this.priceLines.some((p) => p.id === id)) {
      throw new Error(`Duplicate price line id "${id}"`);
    }
    const line = resolvePriceLine(id, input);
    if (line === null) {
      throw new RangeError(`Price line "${id}" needs a finite price`);
    }
    this.priceLines = [...this.priceLines, line];
    this.commit();
    return id;
  }

  /** `false` for an unknown id or a non-finite price. */
  updatePriceLine(id: string, patch: PriceLinePatch): boolean {
    const i = this.priceLines.findIndex((p) => p.id === id);
    if (i < 0) {
      return false;
    }
    const next = resolvePriceLine(id, patch, this.priceLines[i]);
    if (next === null) {
      return false;
    }
    this.priceLines = this.priceLines.map((p, j) => (j === i ? next : p));
    this.commit();
    return true;
  }

  removePriceLine(id: string): boolean {
    const next = this.priceLines.filter((p) => p.id !== id);
    if (next.length === this.priceLines.length) {
      return false;
    }
    this.priceLines = next;
    this.commit();
    return true;
  }

  getPriceLines(): PriceLine[] {
    return this.priceLines.map((p) => ({ ...p }));
  }

  /* ------------------------ Orders / fills / position ------------------------ */

  /** Replaces the open orders; returns how many were accepted. */
  setOrders(orders: readonly OrderInput[]): number {
    this.orders = filterUnique(orders, isValidOrder).items;
    this.commit();
    return this.orders.length;
  }

  getOrders(): OrderInput[] {
    return this.orders.map((o) => ({ ...o }));
  }

  /** Replaces the fills; returns how many were accepted. */
  setFills(fills: readonly FillInput[]): number {
    this.fills = filterUnique(fills, isValidFill).items;
    this.commit();
    return this.fills.length;
  }

  getFills(): FillInput[] {
    return this.fills.map((f) => ({ ...f }));
  }

  /** `null` clears; `false` (and no change) for an invalid position. */
  setPosition(position: PositionInput | null): boolean {
    const next = position === null ? null : normalizePosition(position);
    if (position !== null && next === null) {
      return false;
    }
    this.position = next;
    this.commit();
    return true;
  }

  getPosition(): PositionInput | null {
    return this.position === null ? null : { ...this.position };
  }

  /** Replaces the annotations; returns how many were accepted. */
  setAnnotations(annotations: readonly AnnotationInput[]): number {
    this.annotations = filterUnique(annotations, isValidAnnotation).items;
    this.commit();
    return this.annotations.length;
  }

  getAnnotations(): AnnotationInput[] {
    return this.annotations.map((a) => ({ ...a }));
  }

  /* ------------------------------ UI callbacks ------------------------------ */

  /**
   * A draggable line moved (`'change'`) or was released (`'commit'`) on
   * the UI thread. A commit writes the price into the store (the scene
   * then shows it without waiting for the host); both notify listeners.
   */
  handleLineDrag(
    target: OverlayDragTarget,
    id: string,
    price: number,
    phase: OverlayDragEvent['phase']
  ): void {
    if (!Number.isFinite(price)) {
      return;
    }
    if (phase === 'commit') {
      this.applyLinePrice(target, id, price);
    }
    this.dragListeners.emit({ phase, target, id, price });
  }

  private applyLinePrice(
    target: OverlayDragTarget,
    id: string,
    price: number
  ): void {
    if (target === 'priceLine') {
      if (!this.updatePriceLine(id, { price })) {
        this.commit();
      }
      return;
    }
    if (target === 'order') {
      this.orders = this.orders.map((o) => (o.id === id ? { ...o, price } : o));
    } else if (this.position !== null) {
      this.position =
        target === 'takeProfit'
          ? { ...this.position, takeProfit: price }
          : { ...this.position, stopLoss: price };
    }
    // Always recompile: the UI keeps the dragged value until a new scene.
    this.commit();
  }

  /** Drawing finished by taps on the UI thread. */
  createDrawingFromDraft(
    type: DrawingType,
    anchors: readonly number[]
  ): string {
    const id = this.drawings.createFromDraft(type, anchors, this.keepTool);
    if (id === '') {
      this.commit();
    }
    return id;
  }

  /** Drawing moved / edited on the UI thread (flattened anchors). */
  moveDrawing(id: string, anchors: readonly number[]): boolean {
    const points = [];
    for (let i = 0; i + 1 < anchors.length; i += 2) {
      points.push({
        time: anchors[i] as number,
        price: anchors[i + 1] as number,
      });
    }
    if (!this.drawings.update(id, { anchors: points })) {
      this.commit();
      return false;
    }
    return true;
  }

  /** Removes price lines, orders, fills, the position and annotations. */
  clearOverlays(): void {
    this.priceLines = [];
    this.orders = [];
    this.fills = [];
    this.position = null;
    this.annotations = [];
    this.commit();
  }

  dispose(): void {
    this.sceneListeners.clear();
    this.drawingListeners.clear();
    this.dragListeners.clear();
  }
}
