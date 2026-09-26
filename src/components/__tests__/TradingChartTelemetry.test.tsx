/**
 * Test perspective table — TradingChart telemetry + graceful rendering
 * (Skia mocked, real Reanimated jest utils, fake timers)
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                   |
 * |------|--------------------------------------------------------|--------------------|--------------------------------------------|
 * | TT1  | candles prop with a malformed row                      | Invalid            | onError(data), chart still drawn           |
 * | TT2  | controller.appendBar(invalid) after mount              | Invalid            | onError(data, operation appendBar)         |
 * | TT3  | IANA zone unknown / known / fixed                      | Config             | one config issue / none / none             |
 * | TT4  | onError identity changes                               | Equivalence        | latest handler called, 1 subscription      |
 * | TT5  | onError unset                                          | Boundary (NULL)    | reports are dropped silently               |
 * | TT6  | onPerformanceSample with a 1 s window                  | Equivalence        | samples with fps > 0 and bar count         |
 * | TT7  | onPerformanceSample throws                             | External dep. fail | onError(telemetry, hook), chart alive      |
 * | TT9  | indicator throws during compute                        | External dep. fail | onError(indicator), others + chart alive   |
 * | TT8  | errorFallback + controller change                      | State              | fallback, then chart again (resetKey)      |
 * | TG1  | empty candles                                          | Boundary (empty)   | no fallback, no error                      |
 * | TG2  | one candle                                             | Boundary (min)     | drawn, no error                            |
 * | TG3  | all rows malformed                                     | Invalid            | empty chart, one data issue                |
 * | TG4  | indicator all-NaN (warm-up > bars) on flat prices      | Boundary (NaN)     | no fallback, no error                      |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { Candle } from '../../data/Candle';
import type { ChartErrorEvent } from '../../core/ChartErrors';
import { clearZoneTableCache } from '../../axes/ZoneTable';
import {
  asInternals,
  createTradingChartController,
} from '../../engine/createTradingChartController';
import type { ChartPerformanceSample } from '../../performance/PerformanceSampler';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import { emaModule } from '../../indicators/builtins/MovingAverages';
import type { IndicatorModule } from '../../indicators/IndicatorRegistry';
import { TradingChart } from '../TradingChart';
import type { TradingChartProps } from '../TradingChartProps';

const CANDLES = generateCandles({ count: 300, seed: 9 });
const BAD = { ...(CANDLES[10] as Candle), close: NaN };
const FALLBACK_ID = 'fast-chart-error-fallback';

beforeEach(() => {
  jest.useFakeTimers();
  clearZoneTableCache();
});

function tick(ms = 50) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

async function mounted(
  props: TradingChartProps,
  controller = createTradingChartController()
) {
  const view = await render(
    <TradingChart testID="chart" controller={controller} {...props} />
  );
  fireEvent(view.getByTestId('chart'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 464, height: 324 } },
  });
  tick();
  return { view, controller, handle: asInternals(controller) };
}

/**
 * Unmounts and flushes the fake UI loop so the frame callback is really
 * deactivated before the next test swaps the fake timers (otherwise the
 * Reanimated frame loop of later tests never starts).
 */
function unmountProfiled(view: ReturnType<typeof render>) {
  view.unmount();
  tick(100);
}

const events = (fn: jest.Mock) =>
  fn.mock.calls.map((c) => c[0] as ChartErrorEvent);

describe('TradingChart telemetry', () => {
  it('TT1: malformed candles are reported, the rest drawn', async () => {
    // Given
    const onError = jest.fn();
    const rows = [...CANDLES.slice(0, 10), BAD, ...CANDLES.slice(11)];
    // When
    const { handle, view } = await mounted({ candles: rows, onError });
    // Then
    expect(handle.getBarCount()).toBe(299);
    const [event] = events(onError);
    expect(event?.source).toBe('data');
    expect(event?.fatal).toBe(false);
    expect(event?.error.message).toBe(
      '1 of 300 candles dropped (malformed or duplicate)'
    );
    expect(view.queryByTestId(FALLBACK_ID)).toBeNull();
  });

  it('TT2: rejected realtime bars are reported', async () => {
    // Given
    const onError = jest.fn();
    const { controller } = await mounted({ candles: CANDLES, onError });
    // When
    const ok = controller.appendBar({ ...BAD, time: Number.NaN });
    // Then
    expect(ok).toBe(false);
    expect(events(onError)[0]?.details).toMatchObject({
      operation: 'appendBar',
    });
  });

  it.each<[TradingChartProps['config'], number]>([
    [{ axes: { timeZone: 'Mars/Olympus_Mons' } }, 1],
    [{ axes: { timeZone: 'Asia/Tokyo' } }, 0],
    [{ axes: { timeZone: 540 } }, 0],
  ])('TT3: config %j → %p config issues', async (config, count) => {
    // Given
    const onError = jest.fn();
    // When
    await mounted({ candles: CANDLES, config, onError });
    // Then
    const issues = events(onError).filter((e) => e.source === 'config');
    expect(issues).toHaveLength(count);
    if (count > 0) {
      expect(issues[0]?.error.message).toBe(
        'Time zone "Mars/Olympus_Mons" can\'t be resolved by this runtime\'s Intl; using UTC'
      );
    }
  });

  it('TT4: handler changes do not resubscribe', async () => {
    // Given
    const first = jest.fn();
    const second = jest.fn();
    const { view, controller, handle } = await mounted({ onError: first });
    // When
    await view.rerender(
      <TradingChart testID="chart" controller={controller} onError={second} />
    );
    controller.appendBar(BAD);
    // Then
    expect(handle.errors.size).toBe(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('TT5: without onError reports are dropped', async () => {
    // Given
    const { controller } = await mounted({ candles: CANDLES });
    // When / Then
    expect(() => controller.appendBar(BAD)).not.toThrow();
  });

  it('TT6: emits performance samples', async () => {
    // Given
    const samples: ChartPerformanceSample[] = [];
    const { view } = await mounted({
      candles: CANDLES,
      config: { telemetry: { performanceSampleMs: 1000 } },
      onPerformanceSample: (s) => samples.push(s),
    });
    // When
    tick(3000);
    // Then
    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0]?.fps).toBeGreaterThan(0);
    expect(samples[0]?.bars).toBe(300);
    expect(samples[0]?.durationMs).toBeGreaterThanOrEqual(1000);
    unmountProfiled(view);
  });

  it('TT7: a throwing sample handler is reported as telemetry', async () => {
    // Given
    const onError = jest.fn();
    const { view } = await mounted({
      candles: CANDLES,
      config: { telemetry: { performanceSampleMs: 1000 } },
      onError,
      onPerformanceSample: () => {
        throw new Error('sink down');
      },
    });
    // When
    tick(3000);
    // Then
    const event = events(onError).find((e) => e.source === 'telemetry');
    expect(event?.error.message).toBe('sink down');
    expect(event?.details).toEqual({ hook: 'onPerformanceSample' });
    expect(view.queryByTestId('chart')).not.toBeNull();
    unmountProfiled(view);
  });

  it('TT9: indicator failures are reported, other indicators keep running', async () => {
    // Given
    const onError = jest.fn();
    const controller = createTradingChartController();
    asInternals(controller).indicators.registry.register({
      ...(emaModule as IndicatorModule),
      meta: { ...emaModule.meta, type: 'boom' },
      indicator: {
        type: 'boom',
        calculate: () => {
          throw new Error('boom failed');
        },
      },
    });
    // When
    const { view, handle } = await mounted(
      {
        candles: CANDLES,
        indicators: [
          { type: 'ema', id: 'ok' },
          { type: 'boom', id: 'bad' },
        ],
        onError,
      },
      controller
    );
    tick(100);
    // Then
    const event = events(onError).find((e) => e.source === 'indicator');
    expect(event?.error).toBeInstanceOf(Error);
    expect(event?.error.message).toBe('boom failed');
    expect(event?.fatal).toBe(false);
    expect(handle.indicators.getResult('ok')?.length).toBe(300);
    expect(view.queryByTestId(FALLBACK_ID)).toBeNull();
  });

  it('TT8: a new controller clears a render error', async () => {
    // Given
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const view = await render(
      <TradingChart
        controller={createTradingChartController()}
        indicators={[{ type: 'nope' }]}
        errorFallback={(e) => <Text>{e.message}</Text>}
      />
    );
    expect(view.getByText('Unknown indicator type "nope"')).toBeTruthy();
    // When
    await view.rerender(
      <TradingChart
        testID="chart"
        controller={createTradingChartController()}
        errorFallback={(e) => <Text>{e.message}</Text>}
      />
    );
    // Then
    expect(view.getByTestId('chart')).toBeTruthy();
    error.mockRestore();
  });
});

describe('TradingChart graceful rendering', () => {
  it.each<[string, readonly Candle[], number]>([
    ['TG1 empty', [], 0],
    ['TG2 one candle', CANDLES.slice(0, 1), 1],
  ])('%s', async (_name, candles, bars) => {
    // Given
    const onError = jest.fn();
    // When
    const { view, handle } = await mounted({ candles, onError });
    tick(500);
    // Then
    expect(handle.getBarCount()).toBe(bars);
    expect(view.queryByTestId(FALLBACK_ID)).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('TG3: all rows malformed', async () => {
    // Given
    const onError = jest.fn();
    // When
    const { handle, view } = await mounted({
      candles: [BAD, { ...BAD, time: -1 }, null as unknown as Candle],
      onError,
    });
    // Then
    expect(handle.getBarCount()).toBe(0);
    expect(events(onError)).toHaveLength(1);
    expect(view.queryByTestId(FALLBACK_ID)).toBeNull();
  });

  it('TG4: all-NaN indicator output renders', async () => {
    // Given
    const onError = jest.fn();
    const flat = CANDLES.slice(0, 5).map((c) => ({
      ...c,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
    }));
    // When
    const { view } = await mounted({
      candles: flat,
      indicators: [
        { type: 'ema', config: { period: 200 } },
        { type: 'rsi' },
        { type: 'bollinger' },
      ],
      onError,
    });
    tick(500);
    // Then
    expect(view.queryByTestId(FALLBACK_ID)).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});
