import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  TradingChart,
  deserializeChartSettings,
  serializeChartSettings,
  useTradingChartController,
  type ChartTheme,
  type LoadMoreHandler,
  type TradingChartHandle,
} from 'react-native-fast-chart';
import { IndicatorsSheet } from '../components/IndicatorsSheet';
import { JumpToLatestButton } from '../components/JumpToLatestButton';
import { MarketToolbar } from '../components/MarketToolbar';
import { Toggle } from '../components/Toggle';
import { binanceMarket } from '../market/BinanceMarket';
import { mockMarket } from '../market/MockMarket';
import type { MarketSymbol, MarketTimeframe } from '../market/types';

const CONFIG = { realtime: { lastPricePulse: true } } as const;

interface MarketScreenProps {
  theme: ChartTheme;
}

/**
 * Realtime demo (P7): data flows through the controller only — history
 * via `setData` / `onLoadMore`, ticks via `upsertBar` — so React renders
 * on symbol / timeframe / status changes, never per tick.
 */
export function MarketScreen({ theme }: MarketScreenProps) {
  const controller = useTradingChartController(CONFIG);
  const [symbol, setSymbol] = useState<MarketSymbol>('BTCUSDT');
  const [timeframe, setTimeframe] = useState<MarketTimeframe>('1m');
  const [binance, setBinance] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const market = binance ? binanceMarket : mockMarket;
  const status = useSyncExternalStore(
    useCallback(
      (cb: () => void) => controller.subscribeRealtimeStatus(cb),
      [controller]
    ),
    () => controller.getRealtimeStatus()
  );

  useEffect(() => {
    if (controller.getIndicators().length === 0) {
      controller.addIndicator({ type: 'ema', config: { period: 21 } });
      controller.addIndicator({ type: 'volume' });
    }
  }, [controller]);

  // Symbol / timeframe / source switch: new dataset, keep the zoom.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    controller.setRealtimeStatus('offline');
    market.loadLatest(symbol, timeframe).then(
      (rows) => {
        if (cancelled) return;
        controller.setData(rows, { viewport: 'keepZoom' });
        unsubscribe = market.subscribe(symbol, timeframe, {
          onBar: (bar) => controller.upsertBar(bar),
          onStatus: (s) => controller.setRealtimeStatus(s),
        });
      },
      (error: unknown) => {
        if (!cancelled) setNote(`Load failed: ${String(error)}`);
      }
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [controller, market, symbol, timeframe]);

  const onLoadMore = useCallback<LoadMoreHandler>(
    ({ before }) => market.loadBefore(symbol, timeframe, before),
    [market, symbol, timeframe]
  );

  const save = () => {
    const json = serializeChartSettings(controller.getSettings({ timeframe }));
    setSaved(json);
    setNote(`Saved ${json.length} bytes (in memory)`);
  };
  const restore = () => {
    if (saved === null) return;
    const registry = controller.indicators.registry;
    const { settings, issues } = deserializeChartSettings(saved, (t) =>
      registry.has(t)
    );
    controller.applySettings(settings);
    setNote(`Restored, ${issues.length} issue(s)`);
  };

  const color = theme.axis.textColor;
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color }]}>Market</Text>
        <View style={styles.actions}>
          <Toggle
            label="Indicators"
            theme={theme}
            onPress={() => setSheet(true)}
          />
          <Toggle label="Save" theme={theme} onPress={save} />
          <Toggle label="Restore" theme={theme} onPress={restore} />
          <Toggle
            label={binance ? 'Binance' : 'Mock'}
            active={binance}
            theme={theme}
            onPress={() => setBinance((b) => !b)}
          />
        </View>
      </View>
      <MarketToolbar
        theme={theme}
        symbol={symbol}
        timeframe={timeframe}
        status={status}
        onSymbol={setSymbol}
        onTimeframe={setTimeframe}
      />
      <Text style={[styles.note, { color }]}>
        {note || `${market.name} feed — scroll left to load history`}
      </Text>
      <ComputeStats controller={controller} color={color} />
      <View style={styles.chart}>
        <TradingChart
          controller={controller}
          theme={theme}
          config={CONFIG}
          onLoadMore={onLoadMore}
          historyLoadingIndicator={<ActivityIndicator color={color} />}
        />
        <JumpToLatestButton controller={controller} theme={theme} />
      </View>
      <IndicatorsSheet
        controller={controller}
        theme={theme}
        visible={sheet}
        onClose={() => setSheet(false)}
      />
    </SafeAreaView>
  );
}

/** Full vs incremental indicator computations, refreshed once a second. */
function ComputeStats({
  controller,
  color,
}: {
  controller: TradingChartHandle;
  color: string;
}) {
  const [text, setText] = useState('');
  const read = useMemo(
    () => () => {
      const s = controller.indicators.getComputeStats();
      return `Indicator computes — full ${s.full}, incremental ${s.incremental}`;
    },
    [controller]
  );
  useEffect(() => {
    const timer = setInterval(() => setText(read()), 1000);
    return () => clearInterval(timer);
  }, [read]);
  return <Text style={[styles.note, { color }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  title: { fontSize: 18, fontWeight: '600' },
  note: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  chart: { flex: 1 },
});
