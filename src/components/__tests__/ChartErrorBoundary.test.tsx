/**
 * Test perspective table — ChartErrorBoundary
 *
 * | Case | Input / Precondition                               | Perspective        | Expected                                     |
 * |------|----------------------------------------------------|--------------------|----------------------------------------------|
 * | EB1  | child renders fine                                 | Equivalence        | child shown, onError not called              |
 * | EB2  | child throws, no fallback, no testID               | Abnormal           | default fallback id, onError(render, fatal)  |
 * | EB3  | child throws, testID 'x'                           | Abnormal           | fallback id 'x-error'                        |
 * | EB4  | fallback node                                      | Equivalence        | node rendered                                |
 * | EB5  | fallback function + retry after the fix            | Equivalence        | (error, retry) args, child back on retry     |
 * | EB6  | fallback function throws                           | Abnormal           | default fallback                             |
 * | EB7  | child throws a non-Error (string / object)         | Invalid type       | normalized Error with message                |
 * | EB8  | onError throws / missing                           | External dep. fail | boundary still renders the fallback          |
 * | EB9  | resetKey changes / same key re-render              | State              | error cleared / fallback kept                |
 * | EB11 | componentDidCatch without a component stack         | Boundary (NULL)    | componentStack undefined                     |
 * | EB10 | fallback null                                      | Boundary (NULL)    | nothing rendered (explicit null kept)        |
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { ChartErrorEvent } from '../../core/ChartErrors';
import {
  CHART_ERROR_FALLBACK_TEST_ID,
  ChartErrorBoundary,
} from '../ChartErrorBoundary';

let shouldThrow: unknown = null;
function Child() {
  if (shouldThrow !== null) {
    throw shouldThrow;
  }
  return <Text>chart</Text>;
}

let consoleError: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
  shouldThrow = null;
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

const lastEvent = (fn: jest.Mock) =>
  fn.mock.calls[fn.mock.calls.length - 1]?.[0] as ChartErrorEvent;

describe('ChartErrorBoundary', () => {
  it('EB1: renders children', async () => {
    // Given
    const onError = jest.fn();
    // When
    const view = await render(
      <ChartErrorBoundary onError={onError}>
        <Child />
      </ChartErrorBoundary>
    );
    // Then
    expect(view.getByText('chart')).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it('EB2: default fallback and fatal render event', async () => {
    // Given
    shouldThrow = new TypeError('skia failed');
    const onError = jest.fn();
    // When
    const view = await render(
      <ChartErrorBoundary onError={onError}>
        <Child />
      </ChartErrorBoundary>
    );
    // Then
    expect(view.getByTestId(CHART_ERROR_FALLBACK_TEST_ID)).toBeTruthy();
    const event = lastEvent(onError);
    expect(event.source).toBe('render');
    expect(event.fatal).toBe(true);
    expect(event.error).toBeInstanceOf(TypeError);
    expect(event.error.message).toBe('skia failed');
    expect(typeof event.componentStack).toBe('string');
  });

  it('EB3: fallback testID derives from testID', async () => {
    // Given
    shouldThrow = new Error('x');
    // When
    const view = await render(
      <ChartErrorBoundary testID="x">
        <Child />
      </ChartErrorBoundary>
    );
    // Then
    expect(view.getByTestId('x-error')).toBeTruthy();
  });

  it('EB4: fallback node', async () => {
    // Given
    shouldThrow = new Error('x');
    // When
    const view = await render(
      <ChartErrorBoundary fallback={<Text>oops</Text>}>
        <Child />
      </ChartErrorBoundary>
    );
    // Then
    expect(view.getByText('oops')).toBeTruthy();
  });

  it('EB5: fallback function with retry', async () => {
    // Given
    shouldThrow = new Error('first');
    let retry: () => void = () => {};
    const fallback = jest.fn((error: Error, again: () => void) => {
      retry = again;
      return <Text>{error.message}</Text>;
    });
    const view = await render(
      <ChartErrorBoundary fallback={fallback}>
        <Child />
      </ChartErrorBoundary>
    );
    expect(view.getByText('first')).toBeTruthy();
    // When
    shouldThrow = null;
    await view.rerender(
      <ChartErrorBoundary fallback={fallback}>
        <Child />
      </ChartErrorBoundary>
    );
    expect(view.getByText('first')).toBeTruthy();
    await act(async () => retry());
    // Then
    expect(view.getByText('chart')).toBeTruthy();
  });

  it('EB6: a throwing fallback falls back to the default view', async () => {
    // Given
    shouldThrow = new Error('x');
    const fallback = () => {
      throw new Error('fallback broke');
    };
    // When
    const view = await render(
      <ChartErrorBoundary fallback={fallback}>
        <Child />
      </ChartErrorBoundary>
    );
    // Then
    expect(view.getByTestId(CHART_ERROR_FALLBACK_TEST_ID)).toBeTruthy();
  });

  it.each<[unknown, string]>([
    ['plain string', 'plain string'],
    [{ code: 7 }, 'Non-error thrown: {"code":7}'],
  ])('EB7: non-Error %p is normalized', async (thrown, message) => {
    // Given
    shouldThrow = thrown;
    const onError = jest.fn();
    // When
    await render(
      <ChartErrorBoundary onError={onError}>
        <Child />
      </ChartErrorBoundary>
    );
    // Then
    const event = lastEvent(onError);
    expect(event.error).toBeInstanceOf(Error);
    expect(event.error.message).toBe(message);
  });

  it.each([
    [
      () => {
        throw new Error('telemetry down');
      },
    ],
    [undefined],
  ])('EB8: onError %p never breaks the fallback', async (onError) => {
    // Given
    shouldThrow = new Error('x');
    // When
    const view = await render(
      <ChartErrorBoundary onError={onError}>
        <Child />
      </ChartErrorBoundary>
    );
    // Then
    expect(view.getByTestId(CHART_ERROR_FALLBACK_TEST_ID)).toBeTruthy();
  });

  it('EB9: a new resetKey clears the error, the same key does not', async () => {
    // Given
    shouldThrow = new Error('x');
    const view = await render(
      <ChartErrorBoundary resetKey="BTC">
        <Child />
      </ChartErrorBoundary>
    );
    shouldThrow = null;
    // When: same key
    await view.rerender(
      <ChartErrorBoundary resetKey="BTC">
        <Child />
      </ChartErrorBoundary>
    );
    // Then
    expect(view.getByTestId(CHART_ERROR_FALLBACK_TEST_ID)).toBeTruthy();
    // When: new key
    await view.rerender(
      <ChartErrorBoundary resetKey="ETH">
        <Child />
      </ChartErrorBoundary>
    );
    // Then
    expect(view.getByText('chart')).toBeTruthy();
  });

  it('EB10: an explicit null fallback renders nothing', async () => {
    // Given
    shouldThrow = new Error('x');
    // When
    const view = await render(
      <ChartErrorBoundary fallback={null}>
        <Child />
      </ChartErrorBoundary>
    );
    // Then
    expect(view.toJSON()).toBeNull();
  });

  it('EB11: a missing component stack is reported as undefined', () => {
    // Given
    const onError = jest.fn();
    const boundary = new ChartErrorBoundary({ onError });
    // When
    boundary.componentDidCatch(new Error('x'), { componentStack: null });
    // Then
    expect(lastEvent(onError).componentStack).toBeUndefined();
    expect(lastEvent(onError).error.message).toBe('x');
  });
});
