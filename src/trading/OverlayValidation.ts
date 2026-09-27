import { isLineStyle, sanitizeLineWidth } from './DrawingModel';
import type {
  AnnotationInput,
  FillInput,
  OrderInput,
  PositionInput,
  PriceLine,
  PriceLinePatch,
} from './TradingTypes';

/*
 * Validation of the trading overlay inputs (spec Phase 20.2 applied to
 * overlays): nothing with a NaN / ±∞ coordinate or an unknown enum ever
 * reaches the scene. Invalid entries are dropped (lists) or rejected
 * (single items), never thrown on here. Pure TypeScript.
 */

function isFinitePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isSide(value: unknown): value is 'buy' | 'sell' {
  return value === 'buy' || value === 'sell';
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

/** Resolves a price line input; `null` when the price is not finite. */
export function resolvePriceLine(
  id: string,
  input: PriceLinePatch,
  base?: PriceLine
): PriceLine | null {
  const price = input.price ?? base?.price;
  if (!isFinitePrice(price)) {
    return null;
  }
  return {
    id,
    price,
    color: typeof input.color === 'string' ? input.color : (base?.color ?? ''),
    lineWidth: sanitizeLineWidth(input.lineWidth, base?.lineWidth ?? 1),
    lineStyle: isLineStyle(input.lineStyle)
      ? input.lineStyle
      : (base?.lineStyle ?? 'dashed'),
    label: typeof input.label === 'string' ? input.label : (base?.label ?? ''),
    axisLabel:
      typeof input.axisLabel === 'boolean'
        ? input.axisLabel
        : (base?.axisLabel ?? true),
    draggable:
      typeof input.draggable === 'boolean'
        ? input.draggable
        : (base?.draggable ?? false),
    visible:
      typeof input.visible === 'boolean'
        ? input.visible
        : (base?.visible ?? true),
  };
}

export function isValidOrder(value: unknown): value is OrderInput {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    isId(o.id) &&
    isSide(o.side) &&
    isFinitePrice(o.price) &&
    typeof o.quantity === 'number' &&
    o.quantity >= 0 &&
    o.quantity < Infinity &&
    optionalString(o.type) &&
    optionalString(o.color)
  );
}

export function isValidFill(value: unknown): value is FillInput {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const f = value as Record<string, unknown>;
  return (
    isId(f.id) &&
    isSide(f.side) &&
    isFinitePrice(f.time) &&
    isFinitePrice(f.price) &&
    (f.shape === undefined || f.shape === 'arrow' || f.shape === 'circle') &&
    optionalString(f.color)
  );
}

function optionalLevel(value: unknown): number | null {
  return isFinitePrice(value) ? value : null;
}

/**
 * Normalizes a position: `null` for an invalid side / size / entry;
 * invalid liquidation / TP / SL levels are dropped (set to `null`).
 */
export function normalizePosition(value: unknown): PositionInput | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const p = value as Record<string, unknown>;
  if (
    (p.side !== 'long' && p.side !== 'short') ||
    typeof p.size !== 'number' ||
    !(p.size > 0 && p.size < Infinity) ||
    !isFinitePrice(p.entryPrice) ||
    !(p.id === undefined || isId(p.id))
  ) {
    return null;
  }
  const out: PositionInput = {
    side: p.side,
    size: p.size,
    entryPrice: p.entryPrice,
    liquidationPrice: optionalLevel(p.liquidationPrice),
    takeProfit: optionalLevel(p.takeProfit),
    stopLoss: optionalLevel(p.stopLoss),
    tpSlDraggable: p.tpSlDraggable !== false,
    showPnlArea: p.showPnlArea !== false,
  };
  if (p.id !== undefined) {
    out.id = p.id as string;
  }
  if (typeof p.multiplier === 'number') {
    out.multiplier = p.multiplier;
  }
  return out;
}

const MARKER_POSITIONS = ['above', 'below', 'price'];
const MARKER_SHAPES = ['arrowUp', 'arrowDown', 'circle', 'square', 'diamond'];

export function isValidAnnotation(value: unknown): value is AnnotationInput {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const a = value as Record<string, unknown>;
  if (!isId(a.id) || !optionalString(a.color)) {
    return false;
  }
  const lineStyle = a.lineStyle === undefined || isLineStyle(a.lineStyle);
  switch (a.type) {
    case 'horizontalLine':
      return isFinitePrice(a.price) && lineStyle && optionalString(a.label);
    case 'verticalLine':
      return isFinitePrice(a.time) && lineStyle && optionalString(a.label);
    case 'note':
      return (
        isFinitePrice(a.time) &&
        isFinitePrice(a.price) &&
        typeof a.text === 'string'
      );
    case 'marker': {
      const position = a.position ?? 'above';
      return (
        isFinitePrice(a.time) &&
        MARKER_POSITIONS.includes(position as string) &&
        (position !== 'price' || isFinitePrice(a.price)) &&
        (a.shape === undefined || MARKER_SHAPES.includes(a.shape as string)) &&
        optionalString(a.icon) &&
        optionalString(a.text)
      );
    }
    default:
      return false;
  }
}

/**
 * Keeps the valid items of `list` with a unique id (first wins); copies
 * them. Returns the kept items and the number dropped.
 */
export function filterUnique<T extends { id: string }>(
  list: readonly unknown[] | null | undefined,
  isValid: (value: unknown) => value is T
): { items: T[]; dropped: number } {
  const items: T[] = [];
  if (!Array.isArray(list)) {
    return { items, dropped: 0 };
  }
  const seen = new Set<string>();
  for (const value of list) {
    if (isValid(value) && !seen.has(value.id)) {
      seen.add(value.id);
      items.push({ ...value });
    }
  }
  return { items, dropped: list.length - items.length };
}
