/**
 * Test perspective table — candle validation & normalization
 *
 * | Case | Input / Precondition                              | Perspective        | Expected                                   |
 * |------|---------------------------------------------------|--------------------|--------------------------------------------|
 * | V1   | well-formed candle                                | Equivalence (ok)   | valid, issue null                          |
 * | V2   | doji / flat bar o=h=l=c, volume 0, time 0         | Boundary (min)     | valid                                      |
 * | V3   | time = MAX_SAFE_INTEGER                           | Boundary (max)     | valid                                      |
 * | V4   | negative finite prices                            | Equivalence        | valid (futures can go negative)            |
 * | V5   | null / undefined / number / string                | Invalid type       | NOT_AN_OBJECT                              |
 * | V6   | time -1 / 1.5 / NaN / Infinity / '1' / missing    | Boundary / type    | INVALID_TIME                               |
 * | V7   | time MAX_SAFE_INTEGER + 1                         | Boundary (max+1)   | INVALID_TIME                               |
 * | V8   | price NaN / ±Infinity / string / missing          | Invalid            | NON_FINITE_PRICE                           |
 * | V9   | volume -1 / NaN / Infinity / missing              | Boundary / invalid | INVALID_VOLUME                             |
 * | V10  | high < max(open, close) by epsilon                | Boundary (-1)      | HIGH_BELOW_BODY                            |
 * | V11  | low > min(open, close) by epsilon                 | Boundary (+1)      | LOW_ABOVE_BODY                             |
 * | S1   | empty dataset                                     | Boundary (empty)   | valid, no issues                           |
 * | S2   | single valid candle                               | Boundary (1)       | valid                                      |
 * | S3   | strictly ascending dataset                        | Equivalence        | valid                                      |
 * | S4   | duplicate time                                    | Abnormal           | DUPLICATE_TIME at second row               |
 * | S5   | out-of-order row                                  | Abnormal           | OUT_OF_ORDER                               |
 * | S6   | invalid row between valid rows                    | Abnormal           | row reported, ordering still checked       |
 * | N1   | empty input                                       | Boundary (empty)   | no candles, no issues                      |
 * | N2   | sorted valid input                                | Equivalence        | same values, fresh objects, extra fields dropped |
 * | N3   | unsorted input                                    | Abnormal           | sorted ascending                           |
 * | N4   | duplicates (sorted and unsorted)                  | Abnormal           | last occurrence wins, others reported      |
 * | N5   | invalid rows mixed in                             | Abnormal           | dropped with reason, issues sorted by index|
 * | N6   | missing / null volume                             | Abnormal (tolerated)| volume normalized to 0                    |
 * | N7   | timeUnit 's'                                      | Equivalence        | times multiplied by 1000                   |
 * | N8   | timeUnit 's' with fractional seconds 1.5          | Boundary           | 1500 ms accepted                           |
 * | N9   | timeUnit 's' overflowing safe integer             | Boundary (max+1)   | INVALID_TIME                               |
 * | N10  | all rows invalid                                  | Abnormal           | no candles, every row reported             |
 * | N11  | input array not mutated                           | Safety             | input deep-equals snapshot                 |
 * | N12  | 100k shuffled candles                             | Performance        | sorted result, < 1s                        |
 */
import { describe, expect, it } from '@jest/globals';
import type { Candle } from '../Candle';
import {
  getCandleIssue,
  isValidCandle,
  normalizeCandles,
  validateCandles,
} from '../CandleValidation';

const candle = (overrides: Partial<Record<keyof Candle, unknown>> = {}) => ({
  time: 1_700_000_000_000,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 10,
  ...overrides,
});

describe('getCandleIssue / isValidCandle', () => {
  it('V1: accepts a well-formed candle', () => {
    // Given: a valid candle
    const value = candle();
    // When: validated
    const issue = getCandleIssue(value);
    // Then: no issue
    expect(issue).toBeNull();
    expect(isValidCandle(value)).toBe(true);
  });

  it('V2: accepts a flat bar with zero volume at time 0', () => {
    // Given: o=h=l=c, volume 0, epoch time
    const value = candle({
      time: 0,
      open: 5,
      high: 5,
      low: 5,
      close: 5,
      volume: 0,
    });
    // When / Then
    expect(isValidCandle(value)).toBe(true);
  });

  it('V3: accepts time = Number.MAX_SAFE_INTEGER', () => {
    // Given / When / Then
    expect(isValidCandle(candle({ time: Number.MAX_SAFE_INTEGER }))).toBe(true);
  });

  it('V4: accepts negative finite prices', () => {
    // Given: a negative-priced instrument
    const value = candle({ open: -10, high: -5, low: -40, close: -37 });
    // When / Then
    expect(isValidCandle(value)).toBe(true);
  });

  it.each([null, undefined, 42, 'candle', true])(
    'V5: rejects non-object %p with NOT_AN_OBJECT',
    (value) => {
      // Given: a non-object
      // When: validated
      // Then: NOT_AN_OBJECT
      expect(getCandleIssue(value)).toBe('NOT_AN_OBJECT');
      expect(isValidCandle(value)).toBe(false);
    }
  );

  it.each([-1, 1.5, Number.NaN, Infinity, -Infinity, '1', undefined, null])(
    'V6: rejects time %p with INVALID_TIME',
    (time) => {
      // Given: a candle with a bad timestamp
      // When / Then
      expect(getCandleIssue(candle({ time }))).toBe('INVALID_TIME');
    }
  );

  it('V7: rejects time beyond MAX_SAFE_INTEGER', () => {
    // Given / When / Then
    expect(getCandleIssue(candle({ time: Number.MAX_SAFE_INTEGER + 1 }))).toBe(
      'INVALID_TIME'
    );
  });

  it.each([
    ['open', Number.NaN],
    ['high', Infinity],
    ['low', -Infinity],
    ['close', '105'],
    ['open', undefined],
  ] as Array<[keyof Candle, unknown]>)(
    'V8: rejects %s=%p with NON_FINITE_PRICE',
    (field, value) => {
      // Given: one non-finite price field
      // When / Then
      expect(getCandleIssue(candle({ [field]: value }))).toBe(
        'NON_FINITE_PRICE'
      );
    }
  );

  it.each([-1, -Number.MIN_VALUE, Number.NaN, Infinity, undefined, '10'])(
    'V9: rejects volume %p with INVALID_VOLUME',
    (volume) => {
      // Given / When / Then
      expect(getCandleIssue(candle({ volume }))).toBe('INVALID_VOLUME');
    }
  );

  it.each([
    [{ open: 100, close: 105, high: 104.999 }],
    [{ open: 105, close: 100, high: 104.999 }],
  ])('V10: rejects high below body %p', (fields) => {
    // Given: high just below max(open, close)
    // When / Then
    expect(getCandleIssue(candle(fields))).toBe('HIGH_BELOW_BODY');
  });

  it.each([
    [{ open: 100, close: 105, low: 100.001 }],
    [{ open: 105, close: 100, low: 100.001 }],
  ])('V11: rejects low above body %p', (fields) => {
    // Given: low just above min(open, close)
    // When / Then
    expect(getCandleIssue(candle(fields))).toBe('LOW_ABOVE_BODY');
  });
});

describe('validateCandles', () => {
  it('S1: empty dataset is valid', () => {
    // Given / When
    const result = validateCandles([]);
    // Then
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('S2: single candle is valid', () => {
    // Given / When / Then
    expect(validateCandles([candle()]).valid).toBe(true);
  });

  it('S3: strictly ascending dataset is valid', () => {
    // Given
    const data = [
      candle({ time: 1 }),
      candle({ time: 2 }),
      candle({ time: 3 }),
    ];
    // When / Then
    expect(validateCandles(data)).toEqual({ valid: true, issues: [] });
  });

  it('S4: reports duplicate times', () => {
    // Given
    const data = [candle({ time: 1 }), candle({ time: 1 })];
    // When
    const result = validateCandles(data);
    // Then
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([{ index: 1, reason: 'DUPLICATE_TIME' }]);
  });

  it('S5: reports out-of-order rows', () => {
    // Given
    const data = [
      candle({ time: 5 }),
      candle({ time: 3 }),
      candle({ time: 6 }),
    ];
    // When
    const result = validateCandles(data);
    // Then
    expect(result.issues).toEqual([{ index: 1, reason: 'OUT_OF_ORDER' }]);
  });

  it('S6: reports invalid rows and keeps checking order across them', () => {
    // Given
    const data = [candle({ time: 5 }), null, candle({ time: 5 })];
    // When
    const result = validateCandles(data);
    // Then
    expect(result.issues).toEqual([
      { index: 1, reason: 'NOT_AN_OBJECT' },
      { index: 2, reason: 'DUPLICATE_TIME' },
    ]);
  });
});

describe('normalizeCandles', () => {
  it('N1: empty input yields empty output', () => {
    // Given / When / Then
    expect(normalizeCandles([])).toEqual({ candles: [], issues: [] });
  });

  it('N2: sorted input is copied into fresh plain candles', () => {
    // Given: rows with extra fields
    const input = [
      { ...candle({ time: 1 }), symbol: 'BTC' },
      candle({ time: 2 }),
    ];
    // When
    const { candles, issues } = normalizeCandles(input);
    // Then
    expect(issues).toEqual([]);
    expect(candles).toEqual([candle({ time: 1 }), candle({ time: 2 })]);
    expect(candles[0]).not.toBe(input[0]);
  });

  it('N3: unsorted input is sorted ascending', () => {
    // Given
    const input = [
      candle({ time: 3 }),
      candle({ time: 1 }),
      candle({ time: 2 }),
    ];
    // When
    const { candles } = normalizeCandles(input);
    // Then
    expect(candles.map((c) => c.time)).toEqual([1, 2, 3]);
  });

  it('N4: duplicates keep the last occurrence in input order', () => {
    // Given: time 2 appears three times, unsorted
    const input = [
      candle({ time: 2, close: 101 }),
      candle({ time: 1 }),
      candle({ time: 2, close: 102 }),
      candle({ time: 2, close: 103 }),
    ];
    // When
    const { candles, issues } = normalizeCandles(input);
    // Then
    expect(candles.map((c) => [c.time, c.close])).toEqual([
      [1, 105],
      [2, 103],
    ]);
    expect(issues).toEqual([
      { index: 0, reason: 'DUPLICATE_TIME' },
      { index: 2, reason: 'DUPLICATE_TIME' },
    ]);
  });

  it('N5: invalid rows are dropped with reasons sorted by index', () => {
    // Given
    const input = [
      candle({ time: 3 }),
      candle({ time: 2, high: 1 }),
      'garbage',
      candle({ time: 1, low: Number.NaN }),
      candle({ time: 3 }),
    ];
    // When
    const { candles, issues } = normalizeCandles(input);
    // Then
    expect(candles.map((c) => c.time)).toEqual([3]);
    expect(issues).toEqual([
      { index: 0, reason: 'DUPLICATE_TIME' },
      { index: 1, reason: 'HIGH_BELOW_BODY' },
      { index: 2, reason: 'NOT_AN_OBJECT' },
      { index: 3, reason: 'NON_FINITE_PRICE' },
    ]);
  });

  it('N6: missing or null volume is normalized to 0, negative is rejected', () => {
    // Given
    const input = [
      candle({ time: 1, volume: undefined }),
      candle({ time: 2, volume: null }),
      candle({ time: 3, volume: -5 }),
    ];
    // When
    const { candles, issues } = normalizeCandles(input);
    // Then
    expect(candles.map((c) => c.volume)).toEqual([0, 0]);
    expect(issues).toEqual([{ index: 2, reason: 'INVALID_VOLUME' }]);
  });

  it('N7: converts seconds to milliseconds', () => {
    // Given
    const input = [candle({ time: 1_700_000_000 })];
    // When
    const { candles } = normalizeCandles(input, { timeUnit: 's' });
    // Then
    expect(candles[0]?.time).toBe(1_700_000_000_000);
  });

  it('N8: fractional seconds that map to whole ms are accepted', () => {
    // Given / When
    const { candles } = normalizeCandles([candle({ time: 1.5 })], {
      timeUnit: 's',
    });
    // Then
    expect(candles[0]?.time).toBe(1500);
  });

  it.each([Number.MAX_SAFE_INTEGER, '1', Number.NaN])(
    'N9: rejects second-based time %p that is invalid after conversion',
    (time) => {
      // Given / When
      const { candles, issues } = normalizeCandles([candle({ time })], {
        timeUnit: 's',
      });
      // Then
      expect(candles).toEqual([]);
      expect(issues).toEqual([{ index: 0, reason: 'INVALID_TIME' }]);
    }
  );

  it('N10: all-invalid input yields no candles', () => {
    // Given
    const input = [null, undefined, candle({ time: -1 })];
    // When
    const { candles, issues } = normalizeCandles(input);
    // Then
    expect(candles).toEqual([]);
    expect(issues.map((i) => i.reason)).toEqual([
      'NOT_AN_OBJECT',
      'NOT_AN_OBJECT',
      'INVALID_TIME',
    ]);
  });

  it('N11: does not mutate the input', () => {
    // Given
    const input = [candle({ time: 2 }), candle({ time: 1, volume: undefined })];
    const snapshot = JSON.parse(JSON.stringify(input));
    // When
    normalizeCandles(input);
    // Then
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });

  it('N12: normalizes 100k shuffled candles quickly', () => {
    // Given: 100k candles in reverse order
    const input = Array.from({ length: 100_000 }, (_, i) =>
      candle({ time: (100_000 - i) * 60_000 })
    );
    // When
    const start = Date.now();
    const { candles, issues } = normalizeCandles(input);
    const elapsed = Date.now() - start;
    // Then
    expect(issues).toEqual([]);
    expect(candles).toHaveLength(100_000);
    expect(validateCandles(candles).valid).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});
