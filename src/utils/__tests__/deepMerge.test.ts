/**
 * Test perspective table — deepMerge
 *
 * | Case | Input / Precondition                       | Perspective      | Expected                               |
 * |------|--------------------------------------------|------------------|----------------------------------------|
 * | D1   | nested partial override                    | Equivalence      | only overridden leaves change          |
 * | D2   | override undefined / null / {}             | Boundary (empty) | equal copy, not same reference         |
 * | D3   | inputs                                     | Safety           | neither mutated                        |
 * | D4   | override value undefined                   | Boundary (NULL)  | base value kept                        |
 * | D5   | override value null                        | Boundary (NULL)  | null assigned                          |
 * | D6   | array override                             | Equivalence      | replaced, not merged                   |
 * | D7   | object replaces primitive / vice versa     | Invalid shape    | override wins                          |
 * | D8   | __proto__ / constructor keys               | Security         | ignored, no prototype pollution        |
 * | D9   | class instance / Object.create(null)       | Type             | instance leaf; null-proto merged       |
 * | P1   | isPlainObject on various values            | Type             | true only for plain/null-proto objects |
 */
import { describe, expect, it } from '@jest/globals';
import { deepMerge, isPlainObject } from '../deepMerge';

interface Sample {
  a: number;
  nested: { b: string; c: { d: boolean } };
  list: number[];
  maybe: string | null;
}

const base = (): Sample => ({
  a: 1,
  nested: { b: 'x', c: { d: true } },
  list: [1, 2, 3],
  maybe: 'set',
});

describe('deepMerge', () => {
  it('D1: merges nested partial overrides', () => {
    // Given
    const b = base();
    // When
    const result = deepMerge(b, { nested: { c: { d: false } } });
    // Then
    expect(result).toEqual({ ...b, nested: { b: 'x', c: { d: false } } });
  });

  it.each([undefined, null, {}])('D2: override %p returns a copy', (o) => {
    // Given
    const b = base();
    // When
    const result = deepMerge(b, o);
    // Then
    expect(result).toEqual(b);
    expect(result).not.toBe(b);
  });

  it('D3: does not mutate inputs', () => {
    // Given
    const b = base();
    const override = { nested: { b: 'y' } };
    // When
    deepMerge(b, override);
    // Then
    expect(b).toEqual(base());
    expect(override).toEqual({ nested: { b: 'y' } });
  });

  it('D4: undefined override values keep base values', () => {
    // Given / When
    const result = deepMerge(base(), { a: undefined });
    // Then
    expect(result.a).toBe(1);
  });

  it('D5: null override values are assigned', () => {
    // Given / When / Then
    expect(deepMerge(base(), { maybe: null }).maybe).toBeNull();
  });

  it('D6: arrays are replaced, not merged', () => {
    // Given / When / Then
    expect(deepMerge(base(), { list: [9] }).list).toEqual([9]);
  });

  it('D7: mismatched shapes let the override win', () => {
    // Given
    const b: Record<string, unknown> = { x: 1, y: { z: 1 } };
    // When
    const result = deepMerge(b, { x: { nested: true }, y: 5 });
    // Then
    expect(result).toEqual({ x: { nested: true }, y: 5 });
  });

  it('D8: ignores prototype-polluting keys', () => {
    // Given
    const malicious = JSON.parse(
      '{"__proto__": {"polluted": true}, "constructor": {"x": 1}, "prototype": 1, "a": 2}'
    ) as Partial<Sample>;
    // When
    const result = deepMerge(base(), malicious);
    // Then
    expect(result.a).toBe(2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, 'prototype')).toBe(
      false
    );
  });

  it('D9: class instances are leaves, null-prototype objects are merged', () => {
    // Given
    class Box {
      constructor(public v: number) {}
    }
    const nullProto = Object.assign(Object.create(null) as object, { k: 2 });
    const b: Record<string, unknown> = { box: new Box(1), bag: { k: 1, j: 1 } };
    // When
    const result = deepMerge(b, { box: new Box(2), bag: nullProto });
    // Then
    expect(result.box).toBeInstanceOf(Box);
    expect((result.box as Box).v).toBe(2);
    expect(result.bag).toEqual({ k: 2, j: 1 });
  });
});

describe('isPlainObject', () => {
  it.each<[unknown, boolean]>([
    [{}, true],
    [Object.create(null), true],
    [[], false],
    [null, false],
    [undefined, false],
    [1, false],
    ['s', false],
    [new Date(0), false],
    [() => {}, false],
  ])('P1: isPlainObject(%p) === %p', (value, expected) => {
    // Given / When / Then
    expect(isPlainObject(value)).toBe(expected);
  });
});
