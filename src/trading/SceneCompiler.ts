import { formatPrice } from '../axes/PriceFormat';
import type { ChartTradingTheme } from '../theme/ChartTheme';
import type { Drawing, DrawingType } from './DrawingModel';
import {
  PNL_AT_LINE,
  PNL_LIVE,
  PNL_NONE,
  type OverlayScene,
  type SceneLine,
  type SceneMarker,
} from './OverlayScene';
import type {
  AnnotationInput,
  FillInput,
  OrderInput,
  PositionInput,
  PriceLine,
} from './TradingTypes';

/*
 * Compiles the store's overlay collections into an `OverlayScene` (JS
 * thread, on overlay changes only). Inputs are already validated by the
 * store. Colors become palette indices; `@key` entries reference
 * `theme.trading`. Pure TypeScript.
 */

/** Everything the scene is compiled from. */
export interface SceneSources {
  priceLines: readonly PriceLine[];
  orders: readonly OrderInput[];
  fills: readonly FillInput[];
  position: PositionInput | null;
  annotations: readonly AnnotationInput[];
  drawings: readonly Drawing[];
  tool: DrawingType | '';
  selectedId: string;
  /** Quantity decimals of order labels (`NaN` = as-is). */
  quantityDecimals: number;
}

/** Theme reference stored in the palette (`@buy` → `theme.trading.buy`). */
export function themeColor(key: keyof ChartTradingTheme): string {
  return '@' + key;
}

/** Collects unique palette entries. */
class Palette {
  readonly entries: string[] = [];
  private readonly index = new Map<string, number>();

  add(color: string | undefined, fallback: keyof ChartTradingTheme): number {
    const value =
      typeof color === 'string' && color !== '' ? color : themeColor(fallback);
    let i = this.index.get(value);
    if (i === undefined) {
      i = this.entries.length;
      this.entries.push(value);
      this.index.set(value, i);
    }
    return i;
  }
}

/** Quantity label: fixed decimals when known, else the shortest form. */
export function formatQuantity(quantity: number, decimals: number): string {
  if (!Number.isFinite(quantity)) {
    return '';
  }
  return decimals >= 0 && decimals < Infinity
    ? formatPrice(quantity, decimals, '')
    : String(quantity);
}

function capitalize(text: string): string {
  return text === '' ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** `Limit Buy 0.500` */
export function orderLabel(
  order: OrderInput,
  quantityDecimals: number
): string {
  const type =
    order.type !== undefined && order.type !== '' ? order.type : 'Limit';
  const qty = formatQuantity(order.quantity, quantityDecimals);
  return `${type} ${capitalize(order.side)}${qty === '' ? '' : ' ' + qty}`;
}

function line(
  target: SceneLine['target'],
  id: string,
  price: number,
  color: number,
  fields: Partial<SceneLine>
): SceneLine {
  return {
    key: `${target}:${id}`,
    target,
    id,
    price,
    color,
    width: 1,
    style: 'dashed',
    label: '',
    axisLabel: true,
    draggable: false,
    pnl: PNL_NONE,
    ...fields,
  };
}

function isPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function compilePosition(
  position: PositionInput,
  palette: Palette,
  lines: SceneLine[]
): OverlayScene['position'] {
  const id = position.id ?? 'position';
  const sign = position.side === 'short' ? -1 : 1;
  const draggable = position.tpSlDraggable !== false;
  const size = Math.abs(position.size);
  lines.push(
    line('entry', id, position.entryPrice, palette.add(undefined, 'entry'), {
      style: 'solid',
      label: `${position.side === 'short' ? 'Short' : 'Long'} ${size}`,
      pnl: PNL_LIVE,
    })
  );
  if (isPrice(position.liquidationPrice)) {
    lines.push(
      line(
        'liquidation',
        id,
        position.liquidationPrice,
        palette.add(undefined, 'liquidation'),
        { label: 'Liq.' }
      )
    );
  }
  if (isPrice(position.takeProfit)) {
    lines.push(
      line(
        'takeProfit',
        id,
        position.takeProfit,
        palette.add(undefined, 'takeProfit'),
        { label: 'TP', draggable, pnl: PNL_AT_LINE }
      )
    );
  }
  if (isPrice(position.stopLoss)) {
    lines.push(
      line(
        'stopLoss',
        id,
        position.stopLoss,
        palette.add(undefined, 'stopLoss'),
        { label: 'SL', draggable, pnl: PNL_AT_LINE }
      )
    );
  }
  return {
    id,
    sign,
    size,
    entry: position.entryPrice,
    multiplier:
      typeof position.multiplier === 'number' &&
      position.multiplier > 0 &&
      position.multiplier < Infinity
        ? position.multiplier
        : 1,
    shade: position.showPnlArea !== false,
    profitColor: palette.add(undefined, 'profit'),
    lossColor: palette.add(undefined, 'loss'),
  };
}

function compileAnnotations(
  annotations: readonly AnnotationInput[],
  palette: Palette,
  scene: OverlayScene
): void {
  for (const a of annotations) {
    const color = palette.add(a.color, 'annotation');
    switch (a.type) {
      case 'horizontalLine':
        scene.lines.push(
          line('annotation', a.id, a.price, color, {
            style: a.lineStyle ?? 'dashed',
            label: a.label ?? '',
            axisLabel: false,
          })
        );
        break;
      case 'verticalLine':
        scene.vlines.push({
          key: `annotation:${a.id}`,
          time: a.time,
          color,
          style: a.lineStyle ?? 'dashed',
          label: a.label ?? '',
        });
        break;
      case 'note':
        scene.notes.push({
          key: `annotation:${a.id}`,
          time: a.time,
          price: a.price,
          text: a.text,
          color,
        });
        break;
      case 'marker':
        scene.markers.push({
          key: `annotation:${a.id}`,
          time: a.time,
          price: isPrice(a.price) ? a.price : NaN,
          position: a.position ?? 'above',
          shape: a.shape ?? 'circle',
          color,
          icon: a.icon ?? '',
          text: a.text ?? '',
        });
        break;
    }
  }
}

function fillMarker(fill: FillInput, palette: Palette): SceneMarker {
  const buy = fill.side === 'buy';
  return {
    key: `fill:${fill.id}`,
    time: fill.time,
    price: fill.price,
    position: 'price',
    shape: fill.shape === 'circle' ? 'circle' : buy ? 'arrowUp' : 'arrowDown',
    color: palette.add(fill.color, buy ? 'buy' : 'sell'),
    icon: '',
    text: '',
  };
}

/** Builds the UI snapshot of `sources` (`version` is stored as-is). */
export function compileOverlayScene(
  sources: SceneSources,
  version: number
): OverlayScene {
  const palette = new Palette();
  const scene: OverlayScene = {
    version,
    palette: palette.entries,
    lines: [],
    markers: [],
    vlines: [],
    notes: [],
    drawings: [],
    position: null,
    tool: sources.tool,
    selectedId: sources.selectedId,
  };
  compileAnnotations(sources.annotations, palette, scene);
  for (const p of sources.priceLines) {
    if (p.visible) {
      scene.lines.push(
        line('priceLine', p.id, p.price, palette.add(p.color, 'priceLine'), {
          width: p.lineWidth,
          style: p.lineStyle,
          label: p.label,
          axisLabel: p.axisLabel,
          draggable: p.draggable,
        })
      );
    }
  }
  for (const o of sources.orders) {
    scene.lines.push(
      line(
        'order',
        o.id,
        o.price,
        palette.add(o.color, o.side === 'buy' ? 'buy' : 'sell'),
        {
          label: orderLabel(o, sources.quantityDecimals),
          draggable: o.draggable === true,
        }
      )
    );
  }
  if (sources.position !== null) {
    scene.position = compilePosition(sources.position, palette, scene.lines);
  }
  for (const f of sources.fills) {
    scene.markers.push(fillMarker(f, palette));
  }
  // Stable sort: markers are found by binary search on time.
  scene.markers.sort((a, b) => a.time - b.time);
  for (const d of sources.drawings) {
    const anchors: number[] = [];
    for (const a of d.anchors) {
      anchors.push(a.time, a.price);
    }
    scene.drawings.push({
      id: d.id,
      type: d.type,
      anchors,
      color: palette.add(d.style.color, 'drawing'),
      width: d.style.lineWidth,
      style: d.style.lineStyle,
      locked: d.locked,
    });
  }
  return scene;
}
