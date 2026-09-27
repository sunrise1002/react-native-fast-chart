import {
  createDrawing,
  isDrawingType,
  type Drawing,
  type DrawingInput,
} from '../trading/DrawingModel';

/*
 * Persisted drawings (spec 22.5): `ChartSettings.drawings`, the P7
 * settings schema extended with an optional list (still version 1 — an
 * older payload without drawings restores none, an older reader ignores
 * the field). Pure TypeScript.
 */

/** Issue reported while reading (same shape as `ChartSettingsIssue`). */
export interface DrawingSettingsIssue {
  path: string;
  reason: string;
}

/**
 * Validates a persisted drawing list: entries with a missing / duplicate
 * id, an unknown type or invalid anchors are dropped and reported; styles
 * are repaired field by field. `undefined` yields `undefined` (no field).
 */
export function readDrawingSettings(
  value: unknown,
  issues: DrawingSettingsIssue[]
): Drawing[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({ path: 'drawings', reason: 'not an array' });
    return [];
  }
  const out: Drawing[] = [];
  const seen = new Set<string>();
  value.forEach((item: unknown, i) => {
    const path = `drawings[${i}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      issues.push({ path, reason: 'not an object' });
      return;
    }
    const input = item as Partial<DrawingInput>;
    const id = input.id;
    if (typeof id !== 'string' || id === '' || seen.has(id)) {
      issues.push({ path: `${path}.id`, reason: 'missing or duplicate id' });
      return;
    }
    if (!isDrawingType(input.type)) {
      issues.push({ path: `${path}.type`, reason: 'unknown drawing type' });
      return;
    }
    const drawing = createDrawing(id, input as DrawingInput);
    if (drawing === null) {
      issues.push({ path: `${path}.anchors`, reason: 'invalid anchors' });
      return;
    }
    seen.add(id);
    out.push(drawing);
  });
  return out;
}
