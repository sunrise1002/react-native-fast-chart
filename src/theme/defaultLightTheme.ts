import { defaultTradingTheme, type ChartTheme } from './ChartTheme';

/** Binance-like light theme. */
export const defaultLightTheme: ChartTheme = {
  background: '#FFFFFF',
  surface: '#FAFAFA',
  grid: { color: '#F0F1F2', width: 1, visible: true },
  candle: {
    bullish: '#0ECB81',
    bearish: '#F6465D',
    wickBullish: '#0ECB81',
    wickBearish: '#F6465D',
    neutral: '#929AA5',
    wickWidth: 1,
  },
  axis: {
    textColor: '#707A8A',
    fontSize: 10,
    lineColor: '#EAECEF',
    labelBackground: '#EAECEF',
  },
  crosshair: {
    color: '#929AA5',
    width: 1,
    dash: [4, 4],
    labelBackground: '#474D57',
    labelTextColor: '#FFFFFF',
  },
  lastPrice: {
    lineColor: '#929AA5',
    bullishColor: '#0ECB81',
    bearishColor: '#F6465D',
    labelTextColor: '#FFFFFF',
    lineDash: [2, 2],
  },
  volume: {
    up: 'rgba(14, 203, 129, 0.4)',
    down: 'rgba(246, 70, 93, 0.4)',
  },
  pane: {
    separatorColor: '#EAECEF',
    separatorWidth: 1,
    guideColor: 'rgba(112, 122, 138, 0.6)',
    guideDash: [4, 4],
    guideBandColor: 'rgba(126, 87, 194, 0.08)',
  },
  indicatorPalette: [
    '#C99400',
    '#D1459E',
    '#8E44AD',
    '#2980B9',
    '#16A085',
    '#E67E22',
  ],
  trading: {
    ...defaultTradingTheme,
    entry: '#C99400',
    annotation: '#707A8A',
    drawing: '#1E53E5',
    selection: '#C99400',
    fillOpacity: 0.1,
  },
};
