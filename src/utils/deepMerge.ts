/**
 * Recursive partial type used for theme and config overrides.
 * Arrays and functions are treated as leaf values (replaced, never merged).
 */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function mergeInto(base: PlainObject, override: PlainObject): PlainObject {
  const result: PlainObject = { ...base };
  for (const key of Object.keys(override)) {
    // Guard against prototype pollution through crafted override objects.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    const next = override[key];
    if (next === undefined) {
      continue;
    }
    const current = result[key];
    result[key] =
      isPlainObject(current) && isPlainObject(next)
        ? mergeInto(current, next)
        : next;
  }
  return result;
}

/**
 * Returns a new object where `override` is deep-merged over `base`.
 *
 * - Neither input is mutated.
 * - `undefined` override values are ignored (keep the base value).
 * - Arrays, functions and class instances replace the base value as a whole.
 * - A non-object `override` (null / undefined) returns a shallow copy of `base`.
 */
export function deepMerge<T extends object>(
  base: T,
  override: DeepPartial<T> | null | undefined
): T {
  if (!isPlainObject(override)) {
    return { ...base };
  }
  return mergeInto(base as PlainObject, override) as T;
}
