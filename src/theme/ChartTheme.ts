/** Colors are any Skia-parsable color string (`#RRGGBB`, `#RRGGBBAA`, `rgba()`). */
export type ColorValue = string;

/** Colors of every chart element (see `defaultDarkTheme`). */
export interface ChartTheme {
  /** Canvas background (main chart area). */
  background: ColorValue;
  /** Secondary surface: axes background, headers, tooltips. */
  surface: ColorValue;

  grid: {
    color: ColorValue;
    width: number;
    visible: boolean;
  };

  candle: {
    bullish: ColorValue;
    bearish: ColorValue;
    wickBullish: ColorValue;
    wickBearish: ColorValue;
    /** Color for bars where `open === close`. */
    neutral: ColorValue;
    /** Wick stroke width, dp. */
    wickWidth: number;
  };

  axis: {
    textColor: ColorValue;
    fontSize: number;
    /** Font family name; `undefined` uses the platform default. */
    fontFamily?: string;
    lineColor: ColorValue;
    /** Background of axis labels (crosshair / last price pills). */
    labelBackground: ColorValue;
  };

  crosshair: {
    color: ColorValue;
    width: number;
    /** Dash pattern `[on, off]`, dp; empty array draws a solid line. */
    dash: readonly number[];
    labelBackground: ColorValue;
    labelTextColor: ColorValue;
  };

  lastPrice: {
    lineColor: ColorValue;
    /** Used when the last bar is bullish / bearish. */
    bullishColor: ColorValue;
    bearishColor: ColorValue;
    labelTextColor: ColorValue;
    lineDash: readonly number[];
  };

  volume: {
    up: ColorValue;
    down: ColorValue;
  };

  pane: {
    separatorColor: ColorValue;
    separatorWidth: number;
    /** Indicator guide levels (RSI 30 / 50 / 70). */
    guideColor: ColorValue;
    /** Dash pattern `[on, off]`, dp; empty array draws a solid line. */
    guideDash: readonly number[];
    /** Fill between the guide band levels (RSI 30 … 70). */
    guideBandColor: ColorValue;
  };

  /** Default colors assigned to indicators in order of creation. */
  indicatorPalette: readonly ColorValue[];

  /**
   * Trading overlays and drawings (orders, position, TP / SL, annotations).
   * Optional for themes written before P11: missing keys fall back to
   * `defaultTradingTheme`.
   */
  trading?: Partial<ChartTradingTheme>;
}

/** Colors of the trading overlays (`ChartTheme.trading`). */
export interface ChartTradingTheme {
  /** Buy orders / fills. */
  buy: ColorValue;
  /** Sell orders / fills. */
  sell: ColorValue;
  /** Positive PnL (labels, shading). */
  profit: ColorValue;
  /** Negative PnL. */
  loss: ColorValue;
  /** Position entry line. */
  entry: ColorValue;
  liquidation: ColorValue;
  takeProfit: ColorValue;
  stopLoss: ColorValue;
  /** Default of `addPriceLine`. */
  priceLine: ColorValue;
  /** Default of annotations (lines, notes, markers). */
  annotation: ColorValue;
  /** Default drawing color. */
  drawing: ColorValue;
  /** Anchor handles of the selected drawing. */
  selection: ColorValue;
  /** Text on colored label boxes / badges. */
  labelText: ColorValue;
  /** Opacity of the PnL area and rectangle fills, `0 … 1`. */
  fillOpacity: number;
}

/** Trading colors used when a theme omits (part of) `trading`. */
export const defaultTradingTheme: Readonly<ChartTradingTheme> = Object.freeze({
  buy: '#0ECB81',
  sell: '#F6465D',
  profit: '#0ECB81',
  loss: '#F6465D',
  entry: '#F0B90B',
  liquidation: '#FF8C42',
  takeProfit: '#0ECB81',
  stopLoss: '#F6465D',
  priceLine: '#3498DB',
  annotation: '#848E9C',
  drawing: '#2962FF',
  selection: '#F0B90B',
  labelText: '#FFFFFF',
  fillOpacity: 0.12,
});

/** `theme.trading` completed with `defaultTradingTheme`. */
export function resolveTradingTheme(theme: ChartTheme): ChartTradingTheme {
  const out: ChartTradingTheme = { ...defaultTradingTheme };
  const custom = theme.trading;
  if (custom !== undefined && custom !== null) {
    for (const key of Object.keys(out) as (keyof ChartTradingTheme)[]) {
      const value = custom[key];
      if (key === 'fillOpacity') {
        if (typeof value === 'number' && value >= 0 && value <= 1) {
          out.fillOpacity = value;
        }
      } else if (typeof value === 'string' && value !== '') {
        out[key] = value;
      }
    }
  }
  return out;
}
