import type {
  SkCanvas,
  SkFont,
  SkPathBuilder,
} from '@shopify/react-native-skia';
import { generatePriceTicks, type PriceTicks } from '../../axes/PriceTicks';
import { measureText } from '../../axes/TextMetrics';
import type { TimeScaleState } from '../../viewport/TimeScale';
import { layoutPriceAxisLabels } from '../axes/PriceAxisRenderer';
import { buildGridGeometry } from '../grid/GridGeometry';
import { formatIndicatorValue } from '../overlays/IndicatorLegendRenderer';
import type { PaneDrawItem } from './PanePaints';
import type { ChartFont, ChartPaints } from './SkiaResources';
import type { PaneScaleFrame } from './usePaneScales';

/** No time ticks: pane grids only add horizontal lines. */
const NO_TIME_TICKS = { positions: [] as number[], count: 0 };

export interface PaneAxesContext {
  canvas: SkCanvas;
  grid: SkPathBuilder;
  font: ChartFont;
  skFont: SkFont;
  paints: ChartPaints;
  gridLineWidth: number;
  pixelRatio: number;
  textX: number;
  thousandsSeparator: string;
  /** Reused tick buffer. */
  ticks: PriceTicks;
}

/**
 * Guide levels as the pane's ticks (RSI 30 / 50 / 70): short panes still
 * label the levels that matter instead of a coarse generic step.
 */
function guideTicks(
  levels: readonly number[],
  decimals: number,
  out: PriceTicks
): void {
  'worklet';
  const count = Math.min(levels.length, out.values.length);
  for (let i = 0; i < count; i++) {
    out.values[i] = levels[i] as number;
  }
  out.count = count;
  out.step = NaN;
  out.decimals = decimals >= 0 ? decimals : 0;
}

/**
 * Horizontal grid lines and right-axis labels of every indicator pane
 * (spec §11.2: each pane has its own axis), in the pane's value format.
 * Panes with guide levels are labelled at those levels.
 * Price-pane overlays (volume) get neither. Returns the widest label, dp.
 * Worklet.
 */
export function recordPaneAxes(
  items: readonly PaneDrawItem[],
  frame: PaneScaleFrame | undefined,
  time: TimeScaleState,
  ctx: PaneAxesContext
): number {
  'worklet';
  const { canvas, grid, font, ticks } = ctx;
  const rect = { x: 0, y: 0, width: 0, height: 0 };
  const gridSink = {
    line(_h: boolean, x: number, y: number, w: number, h: number) {
      rect.x = x;
      rect.y = y;
      rect.width = w;
      rect.height = h;
      grid.addRect(rect);
    },
  };
  const textSink = {
    text(text: string, x: number, baseline: number) {
      canvas.drawText(text, x, baseline, ctx.paints.axisText, ctx.skFont);
    },
  };
  let widest = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as PaneDrawItem;
    const price = frame?.scales[i];
    if (item.overlay || price === undefined || !Number.isFinite(price.min)) {
      continue;
    }
    const { decimals, compact } = item.format;
    if (item.guideLevels.length > 0) {
      guideTicks(item.guideLevels, decimals, ticks);
    } else {
      generatePriceTicks(
        price.min,
        price.max,
        price.height,
        font.size,
        ticks,
        decimals >= 0 ? decimals : NaN
      );
    }
    buildGridGeometry(
      time,
      price,
      ticks,
      NO_TIME_TICKS,
      { lineWidth: ctx.gridLineWidth, pixelRatio: ctx.pixelRatio },
      gridSink
    );
    const labels: string[] = [];
    for (let t = 0; t < ticks.count; t++) {
      const value = ticks.values[t] as number;
      const text = formatIndicatorValue(
        value,
        ticks.decimals,
        compact,
        ticks.decimals,
        ctx.thousandsSeparator
      );
      labels.push(text);
      widest = Math.max(widest, measureText(font.glyphs, text));
    }
    layoutPriceAxisLabels(
      ticks,
      labels,
      price,
      { textX: ctx.textX, metrics: font.metrics, gap: 2 },
      null,
      textSink
    );
  }
  return widest;
}
