import { useEffect, useMemo, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  createFrameStats,
  recordFrameInterval,
  summarizeFrameStats,
  TradingChart,
  useTradingChartController,
  type Candle,
  type ChartTheme,
  type FrameStatsSummary,
  type TradingChartHandle,
} from 'react-native-fast-chart';
import { generateCandles } from 'react-native-fast-chart/testing';
import {
  motionAt,
  RUN_MS,
  SETTLE_MS,
  sceneSpacing,
  type BenchScene,
  type SceneMotion,
} from './scenes';

/** Approximate price-axis width: the plot is the window minus this. */
const AXIS_WIDTH = 64;

export interface SceneResult {
  id: string;
  ui: FrameStatsSummary;
  js: FrameStatsSummary;
  /** Bars in the store at the end of the run. */
  bars: number;
  /** Hermes JS heap after the run, MB (`null` off Hermes). */
  heapMb: number | null;
}

interface HermesStats {
  HermesInternal?: { getInstrumentedStats?: () => { js_heapSize?: number } };
}

function heapMb(): number | null {
  const stats = (
    globalThis as HermesStats
  ).HermesInternal?.getInstrumentedStats?.();
  const size = stats?.js_heapSize;
  return typeof size === 'number' ? size / 2 ** 20 : null;
}

/** Random-walk tick: moves the last bar, opens a new one every 60 ticks. */
function tick(controller: TradingChartHandle, last: Candle, n: number): Candle {
  const close = last.close + (Math.random() - 0.5) * last.close * 0.001;
  const next: Candle =
    n % 60 === 0
      ? {
          time: last.time + 60_000,
          open: last.close,
          high: Math.max(last.close, close),
          low: Math.min(last.close, close),
          close,
          volume: Math.random() * 10,
        }
      : {
          ...last,
          close,
          high: Math.max(last.high, close),
          low: Math.min(last.low, close),
          volume: last.volume + Math.random(),
        };
  const ok =
    next.time === last.time
      ? controller.updateLastBar(next)
      : controller.appendBar(next);
  return ok ? next : last;
}

/**
 * Runs one scene: mounts a fresh chart, drives pan / pinch / crosshair
 * from a UI frame callback (which also records UI frame intervals), runs
 * the realtime feed and a JS rAF loop (JS frame intervals), then reports.
 */
export function SceneRun({
  scene,
  theme,
  onDone,
}: {
  scene: BenchScene;
  theme: ChartTheme;
  onDone: (result: SceneResult) => void;
}) {
  const controller = useTradingChartController();
  const { width } = useWindowDimensions();
  const candles = useMemo(
    () => generateCandles({ count: scene.stored, seed: 7 }),
    [scene.stored]
  );
  const spacing = sceneSpacing(scene, width - AXIS_WIDTH);
  const config = useMemo(
    () => ({
      viewport: {
        initialBarSpacing: spacing,
        minBarSpacing: Math.min(0.5, spacing),
        maxBarSpacing: Math.max(64, spacing * 2 ** scene.zoomOctaves),
      },
    }),
    [spacing, scene.zoomOctaves]
  );
  const jsStats = useRef(createFrameStats());
  const uiStats = useSharedValue(createFrameStats());
  const startedAt = useSharedValue(-1);
  const finished = useSharedValue(false);
  const motion = useSharedValue<SceneMotion>({
    rightOffset: 0,
    barSpacing: spacing,
    crosshairIndex: -1,
    crosshairY: 0.5,
  });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const finish = (ui: FrameStatsSummary) =>
    doneRef.current({
      id: scene.id,
      ui,
      js: summarizeFrameStats(jsStats.current),
      bars: controller.store.length,
      heapMb: heapMb(),
    });

  const { state } = controller;
  const { stored, zoomOctaves } = scene;
  const visible = scene.visible ?? stored;
  useFrameCallback((info) => {
    if (finished.value) {
      return;
    }
    if (startedAt.value < 0) {
      startedAt.value = info.timestamp;
    }
    const elapsed = info.timestamp - startedAt.value;
    if (elapsed >= RUN_MS) {
      finished.value = true;
      state.crosshairOpacity.value = 0;
      state.crosshairIndex.value = -1;
      scheduleOnRN(finish, summarizeFrameStats(uiStats.value));
      return;
    }
    if (elapsed < SETTLE_MS) {
      return;
    }
    recordFrameInterval(uiStats.value, info.timeSincePreviousFrame ?? NaN);
    const m = motionAt(
      elapsed,
      stored,
      visible,
      spacing,
      zoomOctaves,
      motion.value
    );
    state.rightOffset.value = m.rightOffset;
    state.barSpacing.value = m.barSpacing;
    state.crosshairIndex.value = m.crosshairIndex;
    state.crosshairY.value = m.crosshairY * state.plotHeight.value;
    state.crosshairOpacity.value = m.crosshairIndex >= 0 ? 1 : 0;
  });

  // JS thread: rAF intervals after the settle time, plus the realtime feed.
  useEffect(() => {
    const t0 = Date.now();
    let prev = NaN;
    let raf = requestAnimationFrame(function loop(now) {
      if (Date.now() - t0 >= SETTLE_MS) {
        recordFrameInterval(jsStats.current, now - prev);
      }
      prev = now;
      raf = requestAnimationFrame(loop);
    });
    let feed: ReturnType<typeof setInterval> | undefined;
    if (scene.ratePerSecond > 0) {
      let last = candles[candles.length - 1] as Candle;
      let n = 0;
      feed = setInterval(() => {
        last = tick(controller, last, ++n);
      }, 1000 / scene.ratePerSecond);
    }
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(feed);
    };
  }, [controller, candles, scene.ratePerSecond]);

  return (
    <TradingChart
      controller={controller}
      candles={candles}
      theme={theme}
      config={config}
      indicators={scene.indicators}
    />
  );
}
