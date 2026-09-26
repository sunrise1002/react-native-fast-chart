import {
  BENCHMARK_SCENARIOS,
  type BenchmarkSceneId,
  type IndicatorInput,
} from 'react-native-fast-chart';

/*
 * Benchmark scenes (spec §28 A–D, the §36 gate and the P8 100k zoom-out
 * scene) and their scripted motion. Every scene runs the same timeline:
 * settle (unmeasured), then pan, pinch and crosshair phases driven from
 * a UI-thread frame callback, so runs are repeatable without touch input.
 */

export interface BenchScene {
  id: string;
  title: string;
  stored: number;
  /** Bars in view; `null` = fit every stored bar. */
  visible: number | null;
  indicators: readonly IndicatorInput[];
  /** Realtime updates per second during the whole run (0 = static). */
  ratePerSecond: number;
  /** Pinch amplitude: zooms in by `2^zoomOctaves` and back. */
  zoomOctaves: number;
}

function fromSpec(id: BenchmarkSceneId): BenchScene {
  const spec = BENCHMARK_SCENARIOS[id];
  return {
    id,
    title: spec.title,
    stored: spec.storedCandles,
    visible: spec.visibleCandles,
    indicators: spec.indicators.map((i) => ({
      type: i.type,
      config: i.config,
    })),
    ratePerSecond: spec.realtimeUpdatesPerSecond,
    zoomOctaves: 2,
  };
}

export const BENCH_SCENES: readonly BenchScene[] = [
  fromSpec('A'),
  fromSpec('B'),
  fromSpec('C'),
  fromSpec('D'),
  {
    id: '§36',
    title: '10k stored, 200 visible, EMA20 + EMA50, 20 updates/s',
    stored: 10_000,
    visible: 200,
    indicators: [
      { type: 'ema', config: { period: 20 } },
      { type: 'ema', config: { period: 50 } },
    ],
    ratePerSecond: 20,
    zoomOctaves: 2,
  },
  {
    id: '100k',
    title: '100k stored, all visible (conflated), EMA20 + volume',
    stored: 100_000,
    visible: null,
    indicators: [
      { type: 'ema', config: { period: 20 } },
      { type: 'volume', config: {} },
    ],
    ratePerSecond: 0,
    zoomOctaves: 7,
  },
];

/** Phase durations, ms. */
export const SETTLE_MS = 1000;
export const PHASE_MS = 4000;
export const PHASES = ['pan', 'pinch', 'crosshair'] as const;
export const RUN_MS = SETTLE_MS + PHASES.length * PHASE_MS;

/** Visible bars and bar spacing that fits them into `plotWidth`. */
export function sceneSpacing(scene: BenchScene, plotWidth: number): number {
  return plotWidth / (scene.visible ?? scene.stored);
}

export interface SceneMotion {
  /** Absolute targets for the chart's shared values. */
  rightOffset: number;
  barSpacing: number;
  /** `-1` = crosshair hidden. */
  crosshairIndex: number;
  /** Share of the plot height, 0 … 1. */
  crosshairY: number;
}

/**
 * Motion at `elapsed` ms into the run (worklet): a cosine pan into
 * history and back, a pinch in by `2^zoomOctaves` and back, then a
 * crosshair sweep across the visible bars.
 */
export function motionAt(
  elapsed: number,
  stored: number,
  visible: number,
  spacing: number,
  zoomOctaves: number,
  out: SceneMotion
): SceneMotion {
  'worklet';
  const t = elapsed - SETTLE_MS;
  const phase = Math.floor(t / PHASE_MS);
  const u = (t - phase * PHASE_MS) / PHASE_MS;
  const wave = (1 - Math.cos(2 * Math.PI * u)) / 2;
  const pan = stored > visible ? Math.min(visible * 2, stored - visible) : 0;
  out.rightOffset = 0;
  out.barSpacing = spacing;
  out.crosshairIndex = -1;
  out.crosshairY = 0.5;
  if (phase === 0) {
    out.rightOffset = -pan * wave;
  } else if (phase === 1) {
    out.barSpacing = spacing * Math.pow(2, zoomOctaves * wave);
  } else if (phase === 2) {
    out.crosshairIndex = Math.round(stored - 1 - visible * (0.05 + 0.9 * u));
    out.crosshairY = 0.2 + 0.6 * wave;
  }
  return out;
}
