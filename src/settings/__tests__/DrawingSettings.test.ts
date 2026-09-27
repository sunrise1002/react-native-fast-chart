/**
 * Test perspective table — DrawingSettings (persisted drawings, spec 22.5)
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                       |
 * |------|--------------------------------------------------------|--------------------|------------------------------------------------|
 * | DS1  | valid list of every tool                               | Equivalence        | all kept, no issues                            |
 * | DS2  | undefined                                              | Boundary (NULL)    | undefined, no issues                           |
 * | DS3  | [] (empty)                                             | Boundary (empty)   | [], no issues                                  |
 * | DS4  | not an array ({} / 'x' / null)                         | Invalid type       | [] + 'not an array'                            |
 * | DS5  | entry null / number / array                            | Invalid type       | dropped, 'not an object'                       |
 * | DS6  | id missing / '' / number / duplicate                   | Invalid / boundary | dropped, 'missing or duplicate id'             |
 * | DS7  | unknown type                                           | Invalid            | dropped, 'unknown drawing type'                |
 * | DS8  | anchors: too few / too many (±1) / NaN / not an array  | Boundary / invalid | dropped, 'invalid anchors'                     |
 * | DS9  | invalid style fields                                   | Invalid            | repaired to defaults, entry kept               |
 * | DS10 | an id dropped for bad anchors can be reused            | Boundary           | later entry with the same id kept              |
 * | CS1  | createChartSettings → serialize → deserialize          | Equivalence        | drawings deep equal (copies)                   |
 * | CS2  | payload without drawings                               | Boundary (NULL)    | no drawings field, no issues                   |
 * | CS3  | payload with a bad drawing                             | Invalid            | dropped with a `drawings[i]…` issue            |
 */
import { describe, expect, it } from '@jest/globals';
import {
  createChartSettings,
  deserializeChartSettings,
  serializeChartSettings,
} from '../ChartSettings';
import {
  readDrawingSettings,
  type DrawingSettingsIssue,
} from '../DrawingSettings';
import {
  DEFAULT_DRAWING_STYLE,
  type Drawing,
} from '../../trading/DrawingModel';

const A = { time: 1_000, price: 10 };
const B = { time: 2_000, price: 20 };
const style = { color: '', lineWidth: 1.5, lineStyle: 'solid' as const };

function read(value: unknown) {
  const issues: DrawingSettingsIssue[] = [];
  return { result: readDrawingSettings(value, issues), issues };
}

const valid: Drawing[] = [
  { id: 't', type: 'trendLine', anchors: [A, B], style, locked: false },
  { id: 'h', type: 'horizontalLine', anchors: [A], style, locked: true },
  { id: 'r', type: 'horizontalRay', anchors: [B], style, locked: false },
  { id: 'x', type: 'rectangle', anchors: [A, B], style, locked: false },
  { id: 'f', type: 'fibRetracement', anchors: [B, A], style, locked: false },
];

describe('readDrawingSettings', () => {
  it('DS1: keeps a valid list', () => {
    // Given / When
    const { result, issues } = read(valid);
    // Then
    expect(result).toEqual(valid);
    expect(issues).toEqual([]);
  });

  it('DS2 / DS3: undefined and empty', () => {
    // Given / When / Then
    expect(read(undefined)).toEqual({ result: undefined, issues: [] });
    expect(read([])).toEqual({ result: [], issues: [] });
  });

  it.each([{}, 'x', null])('DS4: %p is not an array', (value) => {
    // Given / When
    const { result, issues } = read(value);
    // Then
    expect(result).toEqual([]);
    expect(issues).toEqual([{ path: 'drawings', reason: 'not an array' }]);
  });

  it('DS5: non-object entries', () => {
    // Given / When
    const { result, issues } = read([null, 3, [valid[0]]]);
    // Then
    expect(result).toEqual([]);
    expect(issues).toEqual([
      { path: 'drawings[0]', reason: 'not an object' },
      { path: 'drawings[1]', reason: 'not an object' },
      { path: 'drawings[2]', reason: 'not an object' },
    ]);
  });

  it('DS6: bad or duplicate ids', () => {
    // Given
    const base = valid[1] as Drawing;
    // When
    const { result, issues } = read([
      { ...base, id: undefined },
      { ...base, id: '' },
      { ...base, id: 7 },
      base,
      base,
    ]);
    // Then
    expect(result).toEqual([base]);
    expect(issues.map((i) => i.path)).toEqual([
      'drawings[0].id',
      'drawings[1].id',
      'drawings[2].id',
      'drawings[4].id',
    ]);
    expect(issues.every((i) => i.reason === 'missing or duplicate id')).toBe(
      true
    );
  });

  it('DS7: unknown type', () => {
    // Given / When
    const { result, issues } = read([{ ...valid[0], type: 'circle' }]);
    // Then
    expect(result).toEqual([]);
    expect(issues).toEqual([
      { path: 'drawings[0].type', reason: 'unknown drawing type' },
    ]);
  });

  it.each([
    ['too few', [A]],
    ['too many', [A, B, A]],
    ['NaN price', [A, { time: 1, price: NaN }]],
    ['not an array', 'A,B'],
  ])('DS8: anchors %s', (_label, anchors) => {
    // Given / When
    const { result, issues } = read([{ ...valid[0], anchors }]);
    // Then
    expect(result).toEqual([]);
    expect(issues).toEqual([
      { path: 'drawings[0].anchors', reason: 'invalid anchors' },
    ]);
  });

  it('DS9: invalid style fields are repaired', () => {
    // Given / When
    const { result, issues } = read([
      {
        id: 'h',
        type: 'horizontalLine',
        anchors: [A],
        style: { color: 5, lineWidth: -1, lineStyle: 'wavy' },
        locked: 'yes',
      },
    ]);
    // Then
    expect(result?.[0]?.style).toEqual(DEFAULT_DRAWING_STYLE);
    expect(result?.[0]?.locked).toBe(false);
    expect(issues).toEqual([]);
  });

  it('DS10: an id dropped for bad anchors stays available', () => {
    // Given / When
    const { result, issues } = read([{ ...valid[0], anchors: [] }, valid[0]]);
    // Then
    expect(result).toEqual([valid[0]]);
    expect(issues).toHaveLength(1);
  });
});

describe('ChartSettings drawings', () => {
  it('CS1: round trip', () => {
    // Given
    const settings = createChartSettings({
      indicators: [],
      panes: [],
      drawings: valid,
    });
    // When
    const { settings: back, issues } = deserializeChartSettings(
      serializeChartSettings(settings)
    );
    // Then
    expect(issues).toEqual([]);
    expect(back.drawings).toEqual(valid);
    expect(settings.drawings?.[0]).not.toBe(valid[0]);
  });

  it('CS2: no drawings field', () => {
    // Given
    const settings = createChartSettings({ indicators: [], panes: [] });
    // When
    const { settings: back, issues } = deserializeChartSettings(
      serializeChartSettings(settings)
    );
    // Then
    expect(settings.drawings).toBeUndefined();
    expect(back.drawings).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it('CS3: a bad drawing is dropped with an issue', () => {
    // Given
    const payload = JSON.stringify({
      version: 1,
      indicators: [],
      panes: [],
      drawings: [valid[1], { ...valid[0], type: 'arc' }],
    });
    // When
    const { settings, issues } = deserializeChartSettings(payload);
    // Then
    expect(settings.drawings).toEqual([valid[1]]);
    expect(issues).toEqual([
      { path: 'drawings[1].type', reason: 'unknown drawing type' },
    ]);
  });
});
