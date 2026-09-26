import { StyleSheet, Text, View } from 'react-native';
import type { ChartTheme, RealtimeStatus } from 'react-native-fast-chart';
import {
  SYMBOLS,
  TIMEFRAMES,
  type MarketSymbol,
  type MarketTimeframe,
} from '../market/types';
import { Toggle } from './Toggle';

const STATUS_COLOR: Readonly<Record<RealtimeStatus, string>> = {
  live: '#26a69a',
  delayed: '#f5a623',
  reconnecting: '#ef5350',
  offline: '#787b86',
};

interface MarketToolbarProps {
  theme: ChartTheme;
  symbol: MarketSymbol;
  timeframe: MarketTimeframe;
  status: RealtimeStatus;
  onSymbol: (symbol: MarketSymbol) => void;
  onTimeframe: (timeframe: MarketTimeframe) => void;
}

/** Symbol / timeframe selectors and the realtime status badge. */
export function MarketToolbar({
  theme,
  symbol,
  timeframe,
  status,
  onSymbol,
  onTimeframe,
}: MarketToolbarProps) {
  return (
    <View style={styles.bar}>
      {SYMBOLS.map((s) => (
        <Toggle
          key={s}
          label={s.replace('USDT', '')}
          active={s === symbol}
          theme={theme}
          onPress={() => onSymbol(s)}
        />
      ))}
      <View style={styles.gap} />
      {TIMEFRAMES.map((tf) => (
        <Toggle
          key={tf}
          label={tf}
          active={tf === timeframe}
          theme={theme}
          onPress={() => onTimeframe(tf)}
        />
      ))}
      <View style={[styles.badge, { backgroundColor: STATUS_COLOR[status] }]}>
        <Text style={styles.badgeText}>{status}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  gap: { width: 8 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});
