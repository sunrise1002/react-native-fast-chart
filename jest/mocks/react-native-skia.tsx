/**
 * Minimal Jest stand-in for @shopify/react-native-skia, which needs a
 * native (or CanvasKit/WASM) backend. Components render as host elements
 * so tests can assert on the props passed to Skia. `Skia.PathBuilder`
 * returns a recording fake: `detach()` yields a `FakePath` with the rects,
 * path commands and circles that were added. Extend as later phases use more of the Skia API.
 */
import { createElement, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

export interface FakeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Recorded path command: `M`/`L` with a point, `Z` closes a contour. */
export type FakePathCommand =
  { cmd: 'M' | 'L'; x: number; y: number } | { cmd: 'Z' };

/** Recorded `addCircle` call. */
export interface FakeCircle {
  x: number;
  y: number;
  r: number;
}

export class FakePath {
  constructor(
    readonly rects: readonly FakeRect[],
    readonly commands: readonly FakePathCommand[] = [],
    readonly circles: readonly FakeCircle[] = []
  ) {}
}

export class FakePathBuilder {
  rects: FakeRect[] = [];
  commands: FakePathCommand[] = [];
  circles: FakeCircle[] = [];

  reset(): this {
    this.rects = [];
    this.commands = [];
    this.circles = [];
    return this;
  }

  moveTo(x: number, y: number): this {
    this.commands.push({ cmd: 'M', x, y });
    return this;
  }

  lineTo(x: number, y: number): this {
    this.commands.push({ cmd: 'L', x, y });
    return this;
  }

  close(): this {
    this.commands.push({ cmd: 'Z' });
    return this;
  }

  addRect(rect: FakeRect): this {
    this.rects.push({ ...rect });
    return this;
  }

  addCircle(x: number, y: number, r: number): this {
    this.circles.push({ x, y, r });
    return this;
  }

  build(): FakePath {
    return new FakePath([...this.rects], [...this.commands], [...this.circles]);
  }

  detach(): FakePath {
    const path = new FakePath(this.rects, this.commands, this.circles);
    this.rects = [];
    this.commands = [];
    this.circles = [];
    return path;
  }
}

/** Glyph advance of the fake font: `0.6 × size` per character. */
export const FAKE_GLYPH_RATIO = 0.6;

export class FakeFont {
  constructor(
    readonly size: number,
    readonly family?: string
  ) {}

  getGlyphIDs(text: string): number[] {
    return Array.from(text, (c) => c.charCodeAt(0));
  }

  getGlyphWidths(glyphs: number[]): number[] {
    return glyphs.map(() => this.size * FAKE_GLYPH_RATIO);
  }

  getMetrics() {
    return { ascent: -this.size * 0.9, descent: this.size * 0.25, leading: 0 };
  }
}

export function matchFont(style?: { fontSize?: number; fontFamily?: string }) {
  return new FakeFont(style?.fontSize ?? 14, style?.fontFamily);
}

export const PaintStyle = Object.freeze({ Fill: 0, Stroke: 1 });
export type PaintStyle = (typeof PaintStyle)[keyof typeof PaintStyle];
export const StrokeCap = Object.freeze({ Butt: 0, Round: 1, Square: 2 });
export type StrokeCap = (typeof StrokeCap)[keyof typeof StrokeCap];
export const ClipOp = Object.freeze({ Difference: 0, Intersect: 1 });
export type ClipOp = (typeof ClipOp)[keyof typeof ClipOp];
export const StrokeJoin = Object.freeze({ Bevel: 0, Miter: 1, Round: 2 });
export type StrokeJoin = (typeof StrokeJoin)[keyof typeof StrokeJoin];

export class FakePaint {
  color: unknown;
  style: PaintStyle = PaintStyle.Fill;
  strokeWidth = 0;
  pathEffect: unknown = null;
  antiAlias = false;
  alpha = 1;
  strokeCap: StrokeCap = StrokeCap.Butt;
  strokeJoin: StrokeJoin = StrokeJoin.Miter;

  setColor(color: unknown) {
    this.color = color;
  }

  getAlphaf() {
    return this.alpha;
  }

  setAlphaf(alpha: number) {
    this.alpha = alpha;
  }

  setStrokeCap(cap: StrokeCap) {
    this.strokeCap = cap;
  }

  setStrokeJoin(join: StrokeJoin) {
    this.strokeJoin = join;
  }

  setStyle(style: PaintStyle) {
    this.style = style;
  }

  setStrokeWidth(width: number) {
    this.strokeWidth = width;
  }

  setPathEffect(effect: unknown) {
    this.pathEffect = effect;
  }

  setAntiAlias(aa: boolean) {
    this.antiAlias = aa;
  }
}

export type FakeDrawOp =
  | { op: 'text'; text: string; x: number; y: number; paint: FakePaint }
  | {
      op: 'line';
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      paint: FakePaint;
    }
  | {
      op: 'rrect';
      rect: FakeRect;
      paint: FakePaint;
    }
  | { op: 'path'; path: FakePath; paint: FakePaint }
  | { op: 'rect'; rect: FakeRect; paint: FakePaint }
  | { op: 'clip'; rect: FakeRect }
  | { op: 'save' }
  | { op: 'restore' };

export class FakePicture {
  constructor(readonly ops: readonly FakeDrawOp[]) {}

  texts(): string[] {
    return this.ops.flatMap((o) => (o.op === 'text' ? [o.text] : []));
  }
}

export class FakeCanvas {
  ops: FakeDrawOp[] = [];

  drawText(text: string, x: number, y: number, paint: FakePaint) {
    this.ops.push({ op: 'text', text, x, y, paint });
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, paint: FakePaint) {
    this.ops.push({ op: 'line', x0, y0, x1, y1, paint });
  }

  drawRRect(rrect: { rect: FakeRect }, paint: FakePaint) {
    this.ops.push({ op: 'rrect', rect: { ...rrect.rect }, paint });
  }

  drawPath(path: FakePath, paint: FakePaint) {
    this.ops.push({ op: 'path', path, paint });
  }

  drawRect(rect: FakeRect, paint: FakePaint) {
    this.ops.push({ op: 'rect', rect: { ...rect }, paint });
  }

  clipRect(rect: FakeRect) {
    this.ops.push({ op: 'clip', rect: { ...rect } });
  }

  save() {
    this.ops.push({ op: 'save' });
  }

  restore() {
    this.ops.push({ op: 'restore' });
  }
}

export class FakePictureRecorder {
  canvas: FakeCanvas | null = null;

  beginRecording(): FakeCanvas {
    this.canvas = new FakeCanvas();
    return this.canvas;
  }

  finishRecordingAsPicture(): FakePicture {
    const picture = new FakePicture(this.canvas?.ops ?? []);
    this.canvas = null;
    return picture;
  }
}

export const Skia = {
  PathBuilder: {
    Make: () => new FakePathBuilder(),
  },
  Paint: () => new FakePaint(),
  Color: (color: unknown) => color,
  PathEffect: {
    MakeDash: (intervals: number[], phase = 0) => ({ dash: intervals, phase }),
  },
  PictureRecorder: () => new FakePictureRecorder(),
};

export function Canvas({
  children,
  ...props
}: ViewProps & { children?: ReactNode }) {
  return createElement(View, props, children);
}

export function Fill(props: { color?: string }) {
  return createElement('SkiaFill', props);
}

export function Group({
  children,
  ...props
}: {
  children?: ReactNode;
  clip?: unknown;
  opacity?: unknown;
}) {
  return createElement('SkiaGroup', props, children);
}

export function Path(props: { path: unknown; color?: string }) {
  return createElement('SkiaPath', props);
}

export function Rect(props: {
  x: unknown;
  y: unknown;
  width: unknown;
  height: unknown;
  color?: string;
}) {
  return createElement('SkiaRect', props);
}

export function Picture(props: { picture: unknown }) {
  return createElement('SkiaPicture', props);
}

export function Circle(props: {
  cx: unknown;
  cy: unknown;
  r: unknown;
  color?: unknown;
  opacity?: unknown;
}) {
  return createElement('SkiaCircle', props);
}
