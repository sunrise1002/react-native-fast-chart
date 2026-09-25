/**
 * Minimal Jest stand-in for @shopify/react-native-skia, which needs a
 * native (or CanvasKit/WASM) backend. Components render as host elements
 * so tests can assert on the props passed to Skia. Extend as later phases
 * start using more of the Skia API.
 */
import { createElement, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

export function Canvas({
  children,
  ...props
}: ViewProps & { children?: ReactNode }) {
  return createElement(View, props, children);
}

export function Fill(props: { color?: string }) {
  return createElement('SkiaFill', props);
}
