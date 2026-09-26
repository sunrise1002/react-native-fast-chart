import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  reportChartError,
  toError,
  type ChartErrorHandler,
} from '../core/ChartErrors';

/** Rendered instead of the chart after a render error. */
export type ChartErrorFallback =
  ReactNode | ((error: Error, retry: () => void) => ReactNode);

export interface ChartErrorBoundaryProps {
  children?: ReactNode;
  /** Telemetry: called once per caught error (`source: 'render'`). */
  onError?: ChartErrorHandler;
  /** Default: an empty view that keeps the chart's layout slot. */
  fallback?: ChartErrorFallback;
  /** A change of this value clears the error (e.g. the symbol). */
  resetKey?: unknown;
  testID?: string;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

/** `testID` suffix of the default fallback view. */
export const CHART_ERROR_FALLBACK_TEST_ID = 'fast-chart-error-fallback';

/**
 * Protects the host app from chart render errors (spec Phase 20.1): a
 * throw in the chart's React tree (a custom `errorFallback`, a Skia node,
 * a hook) shows the fallback instead of unmounting the host screen.
 * Errors thrown inside UI-thread worklets are not React errors and are
 * not caught here — the renderers guard their inputs instead.
 */
export class ChartErrorBoundary extends Component<
  ChartErrorBoundaryProps,
  State
> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: toError(error) };
  }

  static getDerivedStateFromProps(
    props: ChartErrorBoundaryProps,
    state: State
  ): Partial<State> | null {
    if (Object.is(props.resetKey, state.resetKey)) {
      return null;
    }
    return { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportChartError(this.props.onError, {
      source: 'render',
      error: toError(error),
      fatal: true,
      componentStack: info.componentStack ?? undefined,
    });
  }

  retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const { fallback } = this.props;
    if (typeof fallback === 'function') {
      try {
        return fallback(error, this.retry);
      } catch {
        // A throwing fallback must not escape the boundary.
        return this.renderDefault();
      }
    }
    return fallback !== undefined ? fallback : this.renderDefault();
  }

  private renderDefault(): ReactNode {
    return (
      <View
        style={styles.fallback}
        testID={
          this.props.testID === undefined
            ? CHART_ERROR_FALLBACK_TEST_ID
            : `${this.props.testID}-error`
        }
      />
    );
  }
}

const styles = StyleSheet.create({ fallback: { flex: 1 } });
