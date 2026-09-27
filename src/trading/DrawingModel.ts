import type { ColorValue } from '../theme/ChartTheme';
import type { OverlayLineStyle } from './TradingTypes';

/*
 * Drawing model (spec 22.5). Drawings are anchored in data space — each
 * anchor is `(time, price)` — so they stay attached to the bars while
 * panning / zooming and survive history prepends (indices shift, times
 * don't). Plain JSON data: persisted through `ChartSettings.drawings`.
 * Pure TypeScript.
 */

/** Available drawing tools. */
export type DrawingType =
  | 'trendLine'
  | 'horizontalLine'
  | 'horizontalRay'
  | 'rectangle'
  | 'fibRetracement';

export const DRAWING_TYPES: readonly DrawingType[] = [
  'trendLine',
  'horizontalLine',
  'horizontalRay',
  'rectangle',
  'fibRetracement',
];

/** A data-space point: epoch ms (bar open time or extrapolated slot) + price. */
export interface DrawingAnchor {
  time: number;
  price: number;
}

export interface DrawingStyle {
  /** `''` = theme default (`theme.trading.drawing`). */
  color: ColorValue;
  lineWidth: number;
  lineStyle: OverlayLineStyle;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  /** `DRAWING_ANCHOR_COUNT[type]` anchors. */
  anchors: DrawingAnchor[];
  style: DrawingStyle;
  /** Locked drawings can be selected but not moved. */
  locked: boolean;
}

/** Input of `addDrawing` (id / style / locked optional). */
export interface DrawingInput {
  id?: string;
  type: DrawingType;
  anchors: readonly DrawingAnchor[];
  style?: Partial<DrawingStyle>;
  locked?: boolean;
}

/** Patch of `updateDrawing`. */
export interface DrawingPatch {
  anchors?: readonly DrawingAnchor[];
  style?: Partial<DrawingStyle>;
  locked?: boolean;
}

/** Anchors each tool needs (= taps to create it). */
export const DRAWING_ANCHOR_COUNT: Readonly<Record<DrawingType, number>> =
  Object.freeze({
    trendLine: 2,
    horizontalLine: 1,
    horizontalRay: 1,
    rectangle: 2,
    fibRetracement: 2,
  });

/** Fibonacci retracement levels (0 = second anchor, 1 = first anchor). */
export const FIB_LEVELS: readonly number[] = Object.freeze([
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1,
]);

export const DEFAULT_DRAWING_STYLE: Readonly<DrawingStyle> = Object.freeze({
  color: '',
  lineWidth: 1.5,
  lineStyle: 'solid' as OverlayLineStyle,
});

const LINE_STYLES: readonly OverlayLineStyle[] = ['solid', 'dashed', 'dotted'];

/** Largest accepted line width, dp. */
export const MAX_LINE_WIDTH = 16;

export function isDrawingType(value: unknown): value is DrawingType {
  return DRAWING_TYPES.includes(value as DrawingType);
}

export function isLineStyle(value: unknown): value is OverlayLineStyle {
  return LINE_STYLES.includes(value as OverlayLineStyle);
}

/** Line width when positive and finite (capped), else `fallback`. */
export function sanitizeLineWidth(value: unknown, fallback: number): number {
  return typeof value === 'number' && value > 0 && value < Infinity
    ? Math.min(value, MAX_LINE_WIDTH)
    : fallback;
}

/** `true` for a finite time and a finite price. */
export function isValidAnchor(value: unknown): value is DrawingAnchor {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const { time, price } = value as Record<string, unknown>;
  return (
    typeof time === 'number' &&
    Number.isFinite(time) &&
    typeof price === 'number' &&
    Number.isFinite(price)
  );
}

/** Merges a partial style onto `base`, ignoring invalid fields. */
export function resolveDrawingStyle(
  style: Partial<DrawingStyle> | undefined,
  base: Readonly<DrawingStyle> = DEFAULT_DRAWING_STYLE
): DrawingStyle {
  const out: DrawingStyle = { ...base };
  if (style === undefined || style === null || typeof style !== 'object') {
    return out;
  }
  if (typeof style.color === 'string') {
    out.color = style.color;
  }
  out.lineWidth = sanitizeLineWidth(style.lineWidth, base.lineWidth);
  if (isLineStyle(style.lineStyle)) {
    out.lineStyle = style.lineStyle;
  }
  return out;
}

/**
 * Validates anchors for `type`: exactly the tool's count, all finite.
 * Returns copies, or `null` when invalid.
 */
export function normalizeAnchors(
  type: DrawingType,
  anchors: unknown
): DrawingAnchor[] | null {
  if (!Array.isArray(anchors)) {
    return null;
  }
  if (anchors.length !== DRAWING_ANCHOR_COUNT[type]) {
    return null;
  }
  const out: DrawingAnchor[] = [];
  for (const anchor of anchors) {
    if (!isValidAnchor(anchor)) {
      return null;
    }
    out.push({ time: anchor.time, price: anchor.price });
  }
  return out;
}

/**
 * Builds a stored drawing from an input. Returns `null` (never throws)
 * for an unknown type or invalid anchors; `id` must be resolved by the
 * caller.
 */
export function createDrawing(id: string, input: DrawingInput): Drawing | null {
  if (!isDrawingType(input.type)) {
    return null;
  }
  const anchors = normalizeAnchors(input.type, input.anchors);
  if (anchors === null) {
    return null;
  }
  return {
    id,
    type: input.type,
    anchors,
    style: resolveDrawingStyle(input.style),
    locked: input.locked === true,
  };
}

/** Applies a patch; `null` when the patch anchors are invalid. */
export function patchDrawing(
  drawing: Drawing,
  patch: DrawingPatch
): Drawing | null {
  let anchors = drawing.anchors;
  if (patch.anchors !== undefined) {
    const next = normalizeAnchors(drawing.type, patch.anchors);
    if (next === null) {
      return null;
    }
    anchors = next;
  }
  return {
    id: drawing.id,
    type: drawing.type,
    anchors,
    style:
      patch.style === undefined
        ? drawing.style
        : resolveDrawingStyle(patch.style, drawing.style),
    locked: patch.locked === undefined ? drawing.locked : patch.locked === true,
  };
}

/** Deep copy (drawings handed out by getters are copies). */
export function cloneDrawing(drawing: Drawing): Drawing {
  return {
    id: drawing.id,
    type: drawing.type,
    anchors: drawing.anchors.map((a) => ({ time: a.time, price: a.price })),
    style: { ...drawing.style },
    locked: drawing.locked,
  };
}
