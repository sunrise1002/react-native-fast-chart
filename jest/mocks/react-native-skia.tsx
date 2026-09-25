/**
 * Minimal Jest stand-in for @shopify/react-native-skia, which needs a
 * native (or CanvasKit/WASM) backend. Components render as host elements
 * so tests can assert on the props passed to Skia. `Skia.PathBuilder`
 * returns a recording fake: `detach()` yields a `FakePath` with the rects
 * that were added. Extend as later phases use more of the Skia API.
 */
import { createElement, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

export interface FakeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class FakePath {
  constructor(readonly rects: readonly FakeRect[]) {}
}

export class FakePathBuilder {
  rects: FakeRect[] = [];

  reset(): this {
    this.rects = [];
    return this;
  }

  addRect(rect: FakeRect): this {
    this.rects.push({ ...rect });
    return this;
  }

  build(): FakePath {
    return new FakePath([...this.rects]);
  }

  detach(): FakePath {
    const path = new FakePath(this.rects);
    this.rects = [];
    return path;
  }
}

export const Skia = {
  PathBuilder: {
    Make: () => new FakePathBuilder(),
  },
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
}) {
  return createElement('SkiaGroup', props, children);
}

export function Path(props: { path: unknown; color?: string }) {
  return createElement('SkiaPath', props);
}

export function Rect(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}) {
  return createElement('SkiaRect', props);
}
