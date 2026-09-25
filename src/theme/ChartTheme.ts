/** Colors are any Skia-parsable color string (`#RRGGBB`, `#RRGGBBAA`, `rgba()`). */
export type ColorValue = string;

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
}
