import type { SkPathBuilder } from '@shopify/react-native-skia';
import { Skia } from '@shopify/react-native-skia';
import {
  applyPriceFormatter,
  type PriceFormatter,
} from '../../axes/Formatters';
import { clampSpan } from '../../axes/LabelCollision';
import {
  displayDecimals,
  formatPercent,
  formatSignedPrice,
} from '../../axes/PriceFormat';
import { crispY } from '../../trading/DrawingGeometry';
import {
  addMarkerShape,
  MARKER_SIZE,
  markerCenterY,
} from '../../trading/MarkerGeometry';
import {
  markerLowerBound,
  PNL_AT_LINE,
  PNL_LIVE,
  type OverlayScene,
  type SceneLine,
  type SceneMarker,
} from '../../trading/OverlayScene';
import { pnlPercent, unrealizedPnl } from '../../trading/PositionMath';
import { barIndexAtTime, indexToTime } from '../../trading/TimeAnchor';
import type { TradingHitMap } from '../../engine/TradingState';
import { priceToY } from '../../viewport/PriceScale';
import { indexToX, xToIndex } from '../../viewport/TimeScale';
import { centeredBaseline } from '../RenderModel';
import {
  drawLabelBox,
  LABEL_PADDING_X,
  labelBoxHeight,
  LINE_LABEL_INSET,
  setFill,
  setStroke,
  type TradingFrame,
} from './tradingDrawing';

/*
 * Horizontal levels (price lines, orders, position, TP / SL), their axis
 * badges, the PnL area and the time-anchored markers of the trading
 * overlay picture (UI thread).
 */

/** Label formatting of the levels (symbol precision + formatter). */
export interface LevelFormat {
  pricePrecision: number;
  separator: string;
  priceFormatter?: PriceFormatter;
}

/** Shaded band between the entry and the last close (spec 22.2). */
export function drawPnlArea(
  f: TradingFrame,
  scene: OverlayScene,
  lastClose: number
): void {
  'worklet';
  const p = scene.position;
  if (p === null || !p.shade || !Number.isFinite(lastClose)) {
    return;
  }
  const y0 = priceToY(f.price, p.entry);
  const y1 = priceToY(f.price, lastClose);
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
    return;
  }
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(f.height, Math.max(y0, y1));
  if (bottom <= top) {
    return;
  }
  const profit = (lastClose - p.entry) * p.sign >= 0;
  setFill(f, f.colors[profit ? p.profitColor : p.lossColor], f.fillOpacity);
  f.canvas.drawRect(
    { x: 0, y: top, width: f.width, height: bottom - top },
    f.fill
  );
}

/** Label text of `line` at `price` (appends the live / projected PnL). */
export function levelLabel(
  scene: OverlayScene,
  line: SceneLine,
  price: number,
  lastClose: number,
  separator: string
): string {
  'worklet';
  const p = scene.position;
  if (p === null || (line.pnl !== PNL_LIVE && line.pnl !== PNL_AT_LINE)) {
    return line.label;
  }
  const at = line.pnl === PNL_LIVE ? lastClose : price;
  const pnl = unrealizedPnl(p.sign, p.size, p.entry, at, p.multiplier);
  if (!Number.isFinite(pnl)) {
    return line.label;
  }
  const pct = formatPercent(pnlPercent(p.sign, p.entry, at));
  const text = formatSignedPrice(pnl, 2, separator);
  return `${line.label} ${text}${pct === '' ? '' : ' (' + pct + ')'}`;
}

/**
 * Lines, label boxes and axis badges. `override` replaces the price of
 * the line with key `overrideKey` (drag). Handle boxes go to `hits`.
 */
export function drawLevels(
  f: TradingFrame,
  scene: OverlayScene,
  overrideKey: string,
  overridePrice: number,
  lastClose: number,
  axisWidth: number,
  format: LevelFormat,
  hits: TradingHitMap
): void {
  'worklet';
  const lines = scene.lines;
  const boxH = labelBoxHeight(f);
  hits.version = scene.version;
  hits.count = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as SceneLine;
    const price =
      line.key === overrideKey && Number.isFinite(overridePrice)
        ? overridePrice
        : line.price;
    const rawY = priceToY(f.price, price);
    hits.lines[i * 3] = NaN;
    hits.lines[i * 3 + 1] = 0;
    hits.lines[i * 3 + 2] = 0;
    if (!(rawY >= 0 && rawY <= f.height)) {
      continue;
    }
    const y = crispY(rawY, f.pixelRatio);
    const color = f.colors[line.color];
    setStroke(f, color, line.width, line.style);
    f.canvas.drawLine(0, y, f.width, y, f.stroke);
    let boxColor = color;
    const p = scene.position;
    if (line.pnl === PNL_LIVE && p !== null && Number.isFinite(lastClose)) {
      const profit = (lastClose - p.entry) * p.sign >= 0;
      boxColor = f.colors[profit ? p.profitColor : p.lossColor];
    }
    const text = levelLabel(scene, line, price, lastClose, format.separator);
    const w = drawLabelBox(f, text, LINE_LABEL_INSET, y, boxColor);
    hits.lines[i * 3] = y;
    hits.lines[i * 3 + 1] = LINE_LABEL_INSET;
    hits.lines[i * 3 + 2] = LINE_LABEL_INSET + w;
    if (line.axisLabel && axisWidth > 0) {
      const top = clampSpan(y, boxH, 0, f.height);
      setFill(f, color, 1);
      f.canvas.drawRRect(
        {
          rect: { x: f.width, y: top, width: axisWidth, height: boxH },
          rx: 2,
          ry: 2,
        },
        f.fill
      );
      const decimals = displayDecimals(format.pricePrecision, price);
      f.text.setColor(f.labelText);
      f.canvas.drawText(
        applyPriceFormatter(
          format.priceFormatter,
          price,
          decimals,
          format.separator
        ),
        f.width + LABEL_PADDING_X,
        centeredBaseline(top + boxH / 2, f.metrics),
        f.text,
        f.font
      );
    }
  }
}

function drawMarkerTexts(
  f: TradingFrame,
  markers: readonly SceneMarker[],
  first: number,
  end: number,
  size: number
): void {
  'worklet';
  const s = f.series;
  for (let i = first; i < end; i++) {
    const m = markers[i] as SceneMarker;
    if (m.icon === '' && m.text === '') {
      continue;
    }
    const bar = barIndexAtTime(s, m.time);
    if (bar < 0) {
      continue;
    }
    const at = s.offset + bar;
    const cx = indexToX(f.time, bar);
    const cy = markerCenterY(
      m.position,
      m.shape,
      priceToY(f.price, s.high[at] as number),
      priceToY(f.price, s.low[at] as number),
      priceToY(f.price, m.price),
      size
    );
    if (!Number.isFinite(cy)) {
      continue;
    }
    const baseline = centeredBaseline(cy, f.metrics);
    if (m.icon !== '') {
      f.text.setColor(f.labelText);
      f.canvas.drawText(m.icon, cx - size / 4, baseline, f.text, f.font);
    }
    if (m.text !== '') {
      const color = f.colors[m.color];
      if (color !== undefined) {
        f.text.setColor(color);
      }
      f.canvas.drawText(m.text, cx + size / 2 + 2, baseline, f.text, f.font);
    }
  }
}

/**
 * Markers of the visible bars only (binary search on time), batched into
 * one path per palette color; icons / texts are drawn after the paths.
 * Returns the number of markers drawn.
 */
export function drawMarkers(f: TradingFrame, scene: OverlayScene): number {
  'worklet';
  const markers = scene.markers;
  const s = f.series;
  if (markers.length === 0 || s.length <= 0) {
    return 0;
  }
  const from = indexToTime(s, Math.floor(xToIndex(f.time, 0)) - 1, f.barMs);
  const to = indexToTime(s, Math.ceil(xToIndex(f.time, f.width)) + 1, f.barMs);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return 0;
  }
  const builders: (SkPathBuilder | undefined)[] = [];
  const size = MARKER_SIZE;
  let drawn = 0;
  const first = markerLowerBound(markers, from);
  let end = first;
  for (let i = first; i < markers.length; i++) {
    const m = markers[i] as SceneMarker;
    if (m.time > to) {
      break;
    }
    end = i + 1;
    const bar = barIndexAtTime(s, m.time);
    if (bar < 0) {
      continue;
    }
    const at = s.offset + bar;
    const cx = indexToX(f.time, bar);
    const cy = markerCenterY(
      m.position,
      m.shape,
      priceToY(f.price, s.high[at] as number),
      priceToY(f.price, s.low[at] as number),
      priceToY(f.price, m.price),
      size
    );
    let builder = builders[m.color];
    if (builder === undefined) {
      builder = Skia.PathBuilder.Make();
      builders[m.color] = builder;
    }
    if (addMarkerShape(builder, m.shape, cx, cy, size)) {
      drawn++;
    }
  }
  for (let c = 0; c < builders.length; c++) {
    const builder = builders[c];
    if (builder !== undefined) {
      setFill(f, f.colors[c], 1);
      f.canvas.drawPath(builder.detach(), f.fill);
    }
  }
  drawMarkerTexts(f, markers, first, end, size);
  return drawn;
}
