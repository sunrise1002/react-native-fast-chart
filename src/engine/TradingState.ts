import { scheduleOnUI } from 'react-native-worklets';
import type { DrawingType } from '../trading/DrawingModel';
import type { OverlayScene } from '../trading/OverlayScene';
import type { TradingOverlayStore } from '../trading/TradingOverlayStore';
import type { ChartSharedState } from './ChartSharedState';

/*
 * UI-thread state of the trading overlays: the scene mirrored from the
 * JS store, the interaction state (drag / draft / selection) and the hit
 * map the render mapper leaves for the gestures.
 */

export const DRAG_NONE = 0;
export const DRAG_LINE = 1;
export const DRAG_DRAWING = 2;

/** Drag, draft and selection (UI thread; renderer applies overrides). */
export interface TradingUiState {
  /** `DRAG_*`. */
  dragKind: number;
  /** Released; the override stays until the committed scene arrives. */
  dragPending: boolean;
  /** Scene line key or drawing id. */
  dragKey: string;
  /** Dragged line price. */
  dragPrice: number;
  /** Dragged drawing anchors (flattened). */
  dragAnchors: number[];
  selectedId: string;
  /** Anchors placed so far with the active tool (flattened). */
  draftAnchors: number[];
  /** Draft complete and sent to JS. */
  draftPending: boolean;
}

export function createTradingUiState(): TradingUiState {
  'worklet';
  return {
    dragKind: DRAG_NONE,
    dragPending: false,
    dragKey: '',
    dragPrice: NaN,
    dragAnchors: [],
    selectedId: '',
    draftAnchors: [],
    draftPending: false,
  };
}

/**
 * Line handle boxes of the last rendered frame, per scene line index:
 * `[y, boxLeft, boxRight]` (`NaN` y = not visible). Written in place by
 * the render mapper, read by the drag gesture (never reassigned).
 */
export interface TradingHitMap {
  version: number;
  count: number;
  lines: number[];
}

export function createTradingHitMap(): TradingHitMap {
  'worklet';
  return { version: -1, count: 0, lines: [] };
}

/**
 * Installs a new scene. Ends a pending drag (its value is now in the
 * scene), drops a finished or stale draft and adopts the selection.
 */
export function applyTradingScene(
  state: ChartSharedState,
  scene: OverlayScene
): void {
  'worklet';
  state.tradingScene.value = scene;
  const ui = state.tradingUi.value;
  const dragDone = ui.dragPending;
  const draftDone =
    ui.draftPending || scene.tool === '' || ui.draftAnchors.length === 0;
  state.tradingUi.value = {
    dragKind: dragDone ? DRAG_NONE : ui.dragKind,
    dragPending: false,
    dragKey: dragDone ? '' : ui.dragKey,
    dragPrice: dragDone ? NaN : ui.dragPrice,
    dragAnchors: dragDone ? [] : ui.dragAnchors,
    selectedId: scene.selectedId,
    draftAnchors: draftDone ? [] : ui.draftAnchors,
    draftPending: false,
  };
}

/** Tool of the current draft (the scene's active tool). */
export function activeTool(state: ChartSharedState): DrawingType | '' {
  'worklet';
  return state.tradingScene.value.tool;
}

/**
 * Mirrors the store's scene into `state.tradingScene` (one
 * `scheduleOnUI` per overlay change). Pushes the current scene
 * immediately; returns the unsubscribe function.
 */
export function connectTradingToUi(
  store: TradingOverlayStore,
  state: ChartSharedState
): () => void {
  const push = (scene: OverlayScene) => {
    scheduleOnUI(applyTradingScene, state, scene);
  };
  push(store.getScene());
  return store.subscribeScene(push);
}
