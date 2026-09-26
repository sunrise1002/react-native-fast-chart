import type { SkPath, SkPicture } from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';
import type { PriceFormatter, TimeFormatter } from '../../axes/Formatters';
import type { ChartTimeZone } from '../../axes/TimeZone';
import type { DailyBarsTimeZone } from '../../core/ChartConfig';
import type { PaneDrawItem } from './PanePaints';
import type { ChartFont, ChartPaints } from './SkiaResources';
import type { PaneScaleFrame } from './usePaneScales';

/** Horizontal padding of price labels / badges inside the axis, dp. */
export const AXIS_LABEL_PADDING = 6;
/** Vertical padding of axis badges, dp. */
export const BADGE_PADDING_Y = 3;
/** Corner radius of axis badges, dp. */
export const BADGE_RADIUS = 2;

export interface AxesStyle {
  font: ChartFont;
  paints: ChartPaints;
  gridLineWidth: number;
  pixelRatio: number;
  timeAxisHeight: number;
  /** Fixed decimals, or `NaN` for automatic. */
  pricePrecision: number;
  /** Symbol tick size (axis steps are multiples), `NaN` = none. */
  tickSize?: number;
  thousandsSeparator: string;
  timeZone: ChartTimeZone;
  /** Calendar zone of daily+ bars (default `'utc'`). */
  dailyBarsTimeZone?: DailyBarsTimeZone;
  /** Custom price / time label formatters (worklets; keep stable). */
  priceFormatter?: PriceFormatter;
  timeFormatter?: TimeFormatter;
  showLastPrice: boolean;
  /** Indicator panes (own grid rows and axis labels). */
  panes?: readonly PaneDrawItem[];
  paneScales?: SharedValue<PaneScaleFrame>;
}

/** One frame of the axes layer. */
export interface AxesFrame {
  /** Grid lines from the axis ticks (spec §19.3). */
  grid: SkPath;
  /** Price / time labels, last-price line and badge. */
  picture: SkPicture;
  /** Axis width that fits this frame's widest label, dp. */
  requiredAxisWidth: number;
}
