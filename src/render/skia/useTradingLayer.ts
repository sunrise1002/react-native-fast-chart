import {
  ClipOp,
  PaintStyle,
  Skia,
  type SkColor,
  type SkPicture,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { PriceFormatter } from '../../axes/Formatters';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import { DRAG_DRAWING, DRAG_LINE } from '../../engine/TradingState';
import { DRAWING_ANCHOR_COUNT } from '../../trading/DrawingModel';
import { projectAnchors } from '../../trading/DrawingGeometry';
import {
  isSceneEmpty,
  type SceneDrawing,
  type SceneNote,
  type SceneVLine,
} from '../../trading/OverlayScene';
import type { ChartTradingTheme, ColorValue } from '../../theme/ChartTheme';
import { framePriceScale, frameTimeScale } from './frameScales';
import type { ChartFont } from './SkiaResources';
import {
  drawDrawing,
  drawHandles,
  drawNote,
  drawVerticalLine,
  type TradingFrame,
} from './tradingDrawing';
import { drawLevels, drawMarkers, drawPnlArea } from './tradingLevels';

export interface TradingLayerStyle {
  font: ChartFont;
  trading: ChartTradingTheme;
  pixelRatio: number;
  pricePrecision: number;
  thousandsSeparator: string;
  priceFormatter?: PriceFormatter;
}

/** Resolves a palette entry (`@key` → `theme.trading[key]`). */
export function resolvePaletteColor(
  entry: string,
  trading: ChartTradingTheme
): ColorValue {
  'worklet';
  if (entry.charCodeAt(0) === 64 /* @ */) {
    const value = (trading as unknown as Record<string, unknown>)[
      entry.slice(1)
    ];
    return typeof value === 'string' ? value : trading.annotation;
  }
  return entry;
}

function emptyPicture(): SkPicture {
  const recorder = Skia.PictureRecorder();
  recorder.beginRecording();
  return recorder.finishRecordingAsPicture();
}

/**
 * Trading overlay picture (spec Phase 22): PnL area, vertical lines,
 * drawings (+ draft), levels with label boxes and axis badges, markers
 * and notes — one picture node, rebuilt on the UI thread on viewport /
 * data / scene / drag changes. Returns a cached empty picture while there
 * is nothing to draw, so charts without overlays pay nothing per frame.
 */
export function useTradingLayer(
  state: ChartSharedState,
  barMs: SharedValue<number>,
  style: TradingLayerStyle
): SharedValue<SkPicture> {
  const { trading, font, pixelRatio } = style;
  const resources = useMemo(() => {
    const stroke = Skia.Paint();
    stroke.setAntiAlias(true);
    stroke.setStyle(PaintStyle.Stroke);
    const fill = Skia.Paint();
    fill.setAntiAlias(true);
    const text = Skia.Paint();
    text.setAntiAlias(true);
    return {
      recorder: Skia.PictureRecorder(),
      empty: emptyPicture(),
      stroke,
      fill,
      text,
      dashed: Skia.PathEffect.MakeDash([6, 4], 0),
      dotted: Skia.PathEffect.MakeDash([2, 3], 0),
      selection: Skia.Color(trading.selection),
      labelText: Skia.Color(trading.labelText),
    };
  }, [trading]);
  const { tradingScene, tradingUi, tradingHits } = state;
  const { series, barSpacing, rightOffset, plotWidth, plotHeight } = state;
  const { priceMin, priceMax, priceAxisWidth } = state;
  const { pricePrecision, thousandsSeparator, priceFormatter } = style;

  // Palette colors: once per scene / theme, not per frame.
  const colors = useDerivedValue<SkColor[]>(() =>
    tradingScene.value.palette.map((entry) =>
      Skia.Color(resolvePaletteColor(entry, trading))
    )
  );

  return useDerivedValue<SkPicture>(() => {
    const scene = tradingScene.value;
    const ui = tradingUi.value;
    const draft = ui.draftAnchors;
    const data = series.value;
    if ((isSceneEmpty(scene) && draft.length === 0) || data.length <= 0) {
      tradingHits.value.count = 0;
      return resources.empty;
    }
    const width = plotWidth.value;
    const height = plotHeight.value;
    const canvas = resources.recorder.beginRecording();
    const f: TradingFrame = {
      canvas,
      series: data,
      time: frameTimeScale(plotWidth, barSpacing, rightOffset, data.length),
      price: framePriceScale(plotHeight, priceMin, priceMax),
      barMs: barMs.value,
      width,
      height,
      pixelRatio,
      colors: colors.value,
      stroke: resources.stroke,
      fill: resources.fill,
      text: resources.text,
      dashed: resources.dashed,
      dotted: resources.dotted,
      font: font.font,
      glyphs: font.glyphs,
      metrics: font.metrics,
      lineHeight: font.lineHeight,
      fillOpacity: trading.fillOpacity,
      selection: resources.selection,
      labelText: resources.labelText,
      points: [],
      segment: { x0: 0, y0: 0, x1: 0, y1: 0 },
    };
    const lastClose = data.close[data.offset + data.length - 1] as number;

    canvas.save();
    canvas.clipRect({ x: 0, y: 0, width, height }, ClipOp.Intersect, true);
    drawPnlArea(f, scene, lastClose);
    for (let i = 0; i < scene.vlines.length; i++) {
      const v = scene.vlines[i] as SceneVLine;
      drawVerticalLine(f, v.time, v.color, v.style, v.label);
    }
    const dragging = ui.dragKind === DRAG_DRAWING ? ui.dragKey : '';
    for (let i = 0; i < scene.drawings.length; i++) {
      const d = scene.drawings[i] as SceneDrawing;
      drawDrawing(
        f,
        d,
        d.id === dragging ? ui.dragAnchors : d.anchors,
        d.id === ui.selectedId
      );
    }
    if (draft.length > 0 && scene.tool !== '') {
      const count = draft.length / 2;
      if (count < DRAWING_ANCHOR_COUNT[scene.tool]) {
        if (projectAnchors(data, f.time, f.price, f.barMs, draft, f.points)) {
          drawHandles(f, f.points, count);
        }
      }
    }
    drawMarkers(f, scene);
    for (let i = 0; i < scene.notes.length; i++) {
      const n = scene.notes[i] as SceneNote;
      drawNote(f, n.time, n.price, n.text, n.color);
    }
    canvas.restore();
    // Levels last: their label boxes and axis badges stay on top.
    drawLevels(
      f,
      scene,
      ui.dragKind === DRAG_LINE ? ui.dragKey : '',
      ui.dragPrice,
      lastClose,
      priceAxisWidth.value,
      {
        pricePrecision,
        separator: thousandsSeparator,
        priceFormatter,
      },
      tradingHits.value
    );
    return resources.recorder.finishRecordingAsPicture();
  });
}
