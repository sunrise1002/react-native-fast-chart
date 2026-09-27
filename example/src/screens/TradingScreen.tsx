import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  TradingChart,
  deserializeChartSettings,
  serializeChartSettings,
  useTradingChartController,
  type ChartTheme,
  type OverlayDragEvent,
} from 'react-native-fast-chart';
import { DrawingToolbar } from '../components/DrawingToolbar';
import { SYMBOL_META } from '../market/chartOptions';
import { mockMarket } from '../market/MockMarket';
import { demoTradingState } from '../trading/demoOrders';

interface TradingScreenProps {
  theme: ChartTheme;
}

const CONFIG = { symbol: SYMBOL_META.BTCUSDT };

const TARGET_LABELS: Readonly<Record<OverlayDragEvent['target'], string>> = {
  priceLine: 'Alert',
  order: 'Order',
  takeProfit: 'TP',
  stopLoss: 'SL',
};

/**
 * Trading overlays demo (P11): open orders, fills, a position with PnL,
 * liquidation and draggable TP / SL (UI-thread drag, tick-snapped, one
 * `commit` per release), annotations and the drawing tools.
 */
export function TradingScreen({ theme }: TradingScreenProps) {
  const controller = useTradingChartController(CONFIG);
  const [live, setLive] = useState('Drag TP / SL / the stop order');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    mockMarket.loadLatest('BTCUSDT', '1m').then((rows) => {
      if (cancelled || rows.length === 0) return;
      controller.setData(rows);
      const demo = demoTradingState(rows);
      controller.setOrders(demo.orders);
      controller.setFills(demo.fills);
      controller.setPosition(demo.position);
      controller.setAnnotations(demo.annotations);
      controller.addPriceLine({
        id: 'alert',
        price: demo.orders[1]!.price * 1.004,
        label: 'Alert',
        draggable: true,
      });
      unsubscribe = mockMarket.subscribe('BTCUSDT', '1m', {
        onBar: (bar) => controller.upsertBar(bar),
        onStatus: (status) => controller.setRealtimeStatus(status),
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [controller]);

  // `change` fires on the JS thread only when the snapped price changes;
  // the store already holds the new price when `commit` arrives. A real
  // app would send the amended order / TP / SL to its backend on commit.
  const onOverlayDrag = useCallback((e: OverlayDragEvent) => {
    const label = TARGET_LABELS[e.target];
    setLive(
      e.phase === 'change'
        ? `${label} → ${e.price}`
        : `${label} set to ${e.price}`
    );
  }, []);

  const save = () => {
    setSaved(serializeChartSettings(controller.getSettings()));
    setLive(`Saved ${controller.getDrawings().length} drawing(s)`);
  };
  const restore = () => {
    if (saved === null) return;
    const registry = controller.indicators.registry;
    const { settings, issues } = deserializeChartSettings(saved, (t) =>
      registry.has(t)
    );
    controller.applySettings(settings);
    setLive(`Restored, ${issues.length} issue(s)`);
  };

  const color = theme.axis.textColor;
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.surface }]}>
      <Text style={[styles.title, { color }]}>Trading</Text>
      <DrawingToolbar
        controller={controller}
        theme={theme}
        onSave={save}
        onRestore={restore}
      />
      <Text style={[styles.note, { color }]}>{live}</Text>
      <View style={styles.chart}>
        <TradingChart
          controller={controller}
          theme={theme}
          config={CONFIG}
          onOverlayDrag={onOverlayDrag}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  title: {
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  note: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  chart: { flex: 1 },
});
