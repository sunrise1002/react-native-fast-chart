import { defaultTradingTheme, type ChartTheme } from './ChartTheme';

/** Binance-like dark theme. */
export const defaultDarkTheme: ChartTheme = {
  background: '#0B0E11',
  surface: '#161A1E',
  grid: { color: '#1E2329', width: 1, visible: true },
  candle: {
    bullish: '#0ECB81',
    bearish: '#F6465D',
    wickBullish: '#0ECB81',
    wickBearish: '#F6465D',
    neutral: '#848E9C',
    wickWidth: 1,
  },
  axis: {
    textColor: '#848E9C',
    fontSize: 10,
    lineColor: '#2B3139',
    labelBackground: '#2B3139',
  },
  crosshair: {
    color: '#5E6673',
    width: 1,
    dash: [4, 4],
    labelBackground: '#474D57',
    labelTextColor: '#EAECEF',
  },
  lastPrice: {
    lineColor: '#848E9C',
    bullishColor: '#0ECB81',
    bearishColor: '#F6465D',
    labelTextColor: '#FFFFFF',
    lineDash: [2, 2],
  },
  volume: {
    up: 'rgba(14, 203, 129, 0.5)',
    down: 'rgba(246, 70, 93, 0.5)',
  },
  pane: {
    separatorColor: '#2B3139',
    separatorWidth: 1,
    guideColor: 'rgba(132, 142, 156, 0.6)',
    guideDash: [4, 4],
    guideBandColor: 'rgba(126, 87, 194, 0.08)',
  },
  indicatorPalette: [
    '#F0B90B',
    '#E377C2',
    '#9B59B6',
    '#3498DB',
    '#1ABC9C',
    '#FF8C42',
  ],
  trading: { ...defaultTradingTheme },
};
