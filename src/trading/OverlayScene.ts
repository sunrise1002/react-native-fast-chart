import type { DrawingType } from './DrawingModel';
import type {
  MarkerPosition,
  MarkerShape,
  OverlayDragTarget,
  OverlayLineStyle,
} from './TradingTypes';

/*
 * UI-thread snapshot of every trading overlay (the "scene"). Compiled on
 * the JS thread from the `TradingOverlayStore` whenever an overlay
 * changes (never per frame or per tick) and copied into one shared value;
 * the render mapper and the gesture worklets only read it. Plain arrays
 * and primitives, so it crosses runtimes cheaply. Colors are indices into
 * `palette`, whose entries are color strings or `@<key>` references to
 * `theme.trading` (resolved once per scene / theme on the UI thread).
 */

/** Source of a horizontal scene line. */
export type SceneLineTarget =
  OverlayDragTarget | 'entry' | 'liquidation' | 'annotation';

/** Label PnL mode of a line. */
export const PNL_NONE = 0;
/** Live PnL at the last price (position entry line). */
export const PNL_LIVE = 1;
/** Projected PnL if the price reaches the line (TP / SL). */
export const PNL_AT_LINE = 2;

export interface SceneLine {
  /** `target:id`, unique in the scene (drag identity). */
  key: string;
  target: SceneLineTarget;
  /** Source item id (price line / order / position / annotation). */
  id: string;
  price: number;
  color: number;
  width: number;
  style: OverlayLineStyle;
  /** Label box text (`''` = none unless `pnl` adds one). */
  label: string;
  axisLabel: boolean;
  draggable: boolean;
  /** `PNL_*`. */
  pnl: number;
}

export interface SceneMarker {
  key: string;
  time: number;
  /** Needed for `position: 'price'`; `NaN` otherwise. */
  price: number;
  position: MarkerPosition;
  shape: MarkerShape;
  color: number;
  icon: string;
  text: string;
}

export interface SceneVLine {
  key: string;
  time: number;
  color: number;
  style: OverlayLineStyle;
  label: string;
}

export interface SceneNote {
  key: string;
  time: number;
  price: number;
  text: string;
  color: number;
}

export interface SceneDrawing {
  id: string;
  type: DrawingType;
  /** Flattened anchors `[time0, price0, time1, price1, …]`. */
  anchors: number[];
  color: number;
  width: number;
  style: OverlayLineStyle;
  locked: boolean;
}

export interface ScenePosition {
  id: string;
  /** `1` long, `-1` short. */
  sign: number;
  size: number;
  entry: number;
  multiplier: number;
  /** PnL shading between the entry and the last price. */
  shade: boolean;
  profitColor: number;
  lossColor: number;
}

export interface OverlayScene {
  /** Incremented by every compile. */
  version: number;
  palette: string[];
  lines: SceneLine[];
  /** Sorted by time (visible ones are found by binary search). */
  markers: SceneMarker[];
  vlines: SceneVLine[];
  notes: SceneNote[];
  drawings: SceneDrawing[];
  position: ScenePosition | null;
  /** Active drawing tool (`''` = none). */
  tool: DrawingType | '';
  /** Selected drawing id (`''` = none). */
  selectedId: string;
}

export function emptyOverlayScene(): OverlayScene {
  'worklet';
  return {
    version: 0,
    palette: [],
    lines: [],
    markers: [],
    vlines: [],
    notes: [],
    drawings: [],
    position: null,
    tool: '',
    selectedId: '',
  };
}

/** `true` when nothing would be drawn (render fast path). */
export function isSceneEmpty(scene: OverlayScene): boolean {
  'worklet';
  return (
    scene.lines.length === 0 &&
    scene.markers.length === 0 &&
    scene.vlines.length === 0 &&
    scene.notes.length === 0 &&
    scene.drawings.length === 0
  );
}

/** First marker with `time >= t` (markers sorted by time). */
export function markerLowerBound(
  markers: readonly SceneMarker[],
  t: number
): number {
  'worklet';
  let lo = 0;
  let hi = markers.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((markers[mid] as SceneMarker).time < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
