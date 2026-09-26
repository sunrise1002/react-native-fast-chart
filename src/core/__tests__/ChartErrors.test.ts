/**
 * Test perspective table — ChartErrors
 *
 * | Case | Input / Precondition                               | Perspective        | Expected                                    |
 * |------|----------------------------------------------------|--------------------|---------------------------------------------|
 * | CE1  | toError(Error / TypeError subclass)                | Equivalence        | same instance (type kept)                   |
 * | CE2  | toError('boom') / ''                               | Equivalence / empty| Error with that message                     |
 * | CE3  | toError({code: 1}) / 42 / null                     | Invalid type       | "Non-error thrown: <json>"                  |
 * | CE4  | toError(undefined) / symbol                        | Boundary (NULL)    | String() fallback                           |
 * | CE5  | toError(circular object)                           | Abnormal           | Object.prototype.toString text              |
 * | CE6  | reportChartError with handler                      | Equivalence        | true, handler called once                   |
 * | CE7  | reportChartError undefined / null / non-function   | Boundary (NULL)    | false                                       |
 * | CE8  | reportChartError throwing handler                  | Abnormal           | false, error swallowed                      |
 * | CE9  | chartIssue with / without details                  | Equivalence        | fatal false, details only when given        |
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  chartIssue,
  reportChartError,
  toError,
  type ChartErrorHandler,
} from '../ChartErrors';

describe('toError', () => {
  it('CE1: keeps Error instances', () => {
    // Given
    const error = new TypeError('bad');
    // When / Then
    expect(toError(error)).toBe(error);
  });

  it.each([['boom'], ['']])('CE2: wraps string %p', (text) => {
    // Given / When
    const error = toError(text);
    // Then
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(text);
  });

  it.each<[unknown, string]>([
    [{ code: 1 }, 'Non-error thrown: {"code":1}'],
    [42, 'Non-error thrown: 42'],
    [null, 'Non-error thrown: null'],
  ])('CE3: %p → %p', (value, message) => {
    // Given / When / Then
    expect(toError(value).message).toBe(message);
  });

  it.each<[unknown, string]>([
    [undefined, 'Non-error thrown: undefined'],
    [Symbol('s'), 'Non-error thrown: Symbol(s)'],
  ])('CE4: %p → String() text', (value, message) => {
    // Given / When / Then
    expect(toError(value).message).toBe(message);
  });

  it('CE5: circular objects', () => {
    // Given
    const value: Record<string, unknown> = {};
    value.self = value;
    // When / Then
    expect(toError(value).message).toBe('Non-error thrown: [object Object]');
  });
});

describe('reportChartError', () => {
  const event = chartIssue('data', 'x');

  it('CE6: calls the handler', () => {
    // Given
    const handler = jest.fn<ChartErrorHandler>();
    // When / Then
    expect(reportChartError(handler, event)).toBe(true);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it.each([[undefined], [null], ['fn' as unknown as ChartErrorHandler]])(
    'CE7: no handler %p → false',
    (handler) => {
      // Given / When / Then
      expect(reportChartError(handler, event)).toBe(false);
    }
  );

  it('CE8: swallows handler errors', () => {
    // Given
    const handler: ChartErrorHandler = () => {
      throw new Error('telemetry down');
    };
    // When / Then
    expect(() => reportChartError(handler, event)).not.toThrow();
    expect(reportChartError(handler, event)).toBe(false);
  });
});

describe('chartIssue', () => {
  it('CE9: non-fatal events with optional details', () => {
    // Given / When
    const plain = chartIssue('config', 'bad zone');
    const detailed = chartIssue('indicator', new RangeError('r'), {
      id: 'ema',
    });
    // Then
    expect(plain.fatal).toBe(false);
    expect(plain.source).toBe('config');
    expect(plain.error.message).toBe('bad zone');
    expect('details' in plain).toBe(false);
    expect(detailed.error).toBeInstanceOf(RangeError);
    expect(detailed.details).toEqual({ id: 'ema' });
  });
});
