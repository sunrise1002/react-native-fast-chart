import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  interactionTickSize,
  resolveSymbolPrecision,
} from '../axes/SymbolPrecision';
import type { ChartConfig } from '../core/ChartConfig';
import type { ChartControllerInternals } from '../engine/ChartHandle';
import { connectTradingToUi } from '../engine/TradingState';
import type { OverlayTapOptions } from '../interaction/useChartGestures';
import {
  useTradingGestures,
  type TradingGestures,
} from '../interaction/useTradingGestures';
import type { DrawingType } from '../trading/DrawingModel';
import type {
  OverlayDragHandler,
  OverlayDragTarget,
} from '../trading/TradingTypes';

const DRAG_TARGETS: readonly string[] = [
  'priceLine',
  'order',
  'takeProfit',
  'stopLoss',
];

function isDragTarget(value: string): value is OverlayDragTarget {
  return DRAG_TARGETS.includes(value);
}

export interface TradingOverlayWiring {
  gestures: TradingGestures;
  /** Overlay tap for `useChartGestures` (drawing mode drops double tap). */
  overlayTap: OverlayTapOptions;
}

/**
 * Connects the controller's trading overlays to the chart: mirrors the
 * scene to the UI thread, routes the overlay gestures' results back to
 * the store and forwards level drags to `onOverlayDrag`. React only
 * re-renders when drawing mode toggles (it changes the gesture tree).
 */
export function useTradingOverlays(
  handle: ChartControllerInternals,
  config: ChartConfig,
  onOverlayDrag: OverlayDragHandler | undefined
): TradingOverlayWiring {
  const store = handle.trading;
  useEffect(() => connectTradingToUi(store, handle.state), [store, handle]);
  useEffect(
    () =>
      onOverlayDrag === undefined
        ? undefined
        : store.subscribeDrag(onOverlayDrag),
    [store, onOverlayDrag]
  );
  const drawingMode = useSyncExternalStore(
    useCallback((cb: () => void) => store.subscribeDrawings(cb), [store]),
    () => store.drawings.activeTool !== ''
  );

  const tickSize = useMemo(
    () =>
      interactionTickSize(
        resolveSymbolPrecision(config.symbol, config.axes.pricePrecision)
      ),
    [config.symbol, config.axes.pricePrecision]
  );
  const onLineDrag = useCallback(
    (target: string, id: string, price: number, phase: 'change' | 'commit') => {
      if (isDragTarget(target)) {
        store.handleLineDrag(target, id, price, phase);
      }
    },
    [store]
  );
  const onDrawingMove = useCallback(
    (id: string, anchors: number[]) => {
      store.moveDrawing(id, anchors);
    },
    [store]
  );
  const onDraftComplete = useCallback(
    (tool: DrawingType, anchors: number[]) => {
      store.createDrawingFromDraft(tool, anchors);
    },
    [store]
  );
  const onSelect = useCallback(
    (id: string) => {
      store.drawings.select(id === '' ? null : id);
    },
    [store]
  );
  const gestures = useTradingGestures(
    handle.state,
    {
      enabled: config.trading.dragEnabled,
      hitSlop: config.trading.hitSlop,
      tickSize,
    },
    { onLineDrag, onDrawingMove, onDraftComplete, onSelect }
  );
  const overlayTap = useMemo(
    () => ({ tap: gestures.tap, drawingMode }),
    [gestures.tap, drawingMode]
  );
  return { gestures, overlayTap };
}
