/**
 * Test perspective table — DrawingCollection
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                        |
 * |------|--------------------------------------------------------|--------------------|-------------------------------------------------|
 * | DC1  | add with / without id                                  | Equivalence        | stored on top, generated `drawing-N`, onChange  |
 * | DC2  | add duplicate id / empty id / non-string id            | Invalid            | Error "Invalid or duplicate drawing id"         |
 * | DC3  | add invalid type / anchors                             | Invalid            | Error "Invalid drawing"                         |
 * | DC4  | generated id skips taken ids                           | Boundary           | next free id                                    |
 * | DC5  | update valid / unknown id / invalid anchors            | Equiv. / Invalid   | true / false / false (no onChange)              |
 * | DC6  | remove selected / unknown                              | Equiv. / Invalid   | selection cleared / false                       |
 * | DC7  | setAll drops invalid + duplicates, keeps selection     | Equivalence        | accepted count                                  |
 * | DC8  | setAll without the selected id / not an array / empty  | Boundary / Invalid | selection cleared, 0                            |
 * | DC9  | get / getAll return copies; unknown get                | Equivalence        | clones / undefined                              |
 * | DC10 | select known / same / null / unknown                   | Equiv. / Invalid   | true (one onChange) / false                     |
 * | DC11 | setTool valid (clears selection) / same / null / bad   | Equiv. / Invalid   | true / no change / off / false                  |
 * | DC12 | createFromDraft complete / keepTool / odd length / bad | Equiv. / Invalid   | id + selected, tool off or kept / ''            |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DrawingCollection } from '../DrawingCollection';
import type { DrawingInput, DrawingType } from '../DrawingModel';

const line: DrawingInput = {
  type: 'trendLine',
  anchors: [
    { time: 1, price: 10 },
    { time: 2, price: 20 },
  ],
};

let onChange: jest.Mock<() => void>;
let c: DrawingCollection;

beforeEach(() => {
  onChange = jest.fn<() => void>();
  c = new DrawingCollection(onChange);
});

describe('add', () => {
  it('DC1: adds on top with generated ids', () => {
    // Given / When
    const a = c.add(line);
    const b = c.add({ ...line, id: 'mine' });
    // Then
    expect([a, b]).toEqual(['drawing-1', 'mine']);
    expect(c.items.map((d) => d.id)).toEqual(['drawing-1', 'mine']);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it.each([['dup'], [''], [5 as unknown as string]])(
    'DC2: id %p throws',
    (id) => {
      // Given
      c.add({ ...line, id: 'dup' });
      // When / Then
      expect(() => c.add({ ...line, id })).toThrow(
        new Error(`Invalid or duplicate drawing id "${String(id)}"`)
      );
    }
  );

  it.each([
    [{ ...line, type: 'circle' as DrawingType }],
    [{ ...line, anchors: [] }],
  ])('DC3: invalid drawing %# throws', (input) => {
    // Given / When / Then
    expect(() => c.add({ ...input, id: 'x' })).toThrow(
      new Error('Invalid drawing "x" (type or anchors)')
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('DC4: generated ids skip taken ones', () => {
    // Given
    c.add({ ...line, id: 'drawing-1' });
    // When / Then
    expect(c.add(line)).toBe('drawing-2');
  });
});

describe('update / remove', () => {
  it('DC5: update', () => {
    // Given
    const id = c.add(line);
    onChange.mockClear();
    // When / Then
    expect(c.update(id, { locked: true })).toBe(true);
    expect(c.items[0]?.locked).toBe(true);
    expect(c.update('nope', { locked: true })).toBe(false);
    expect(c.update(id, { anchors: [] })).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('DC6: remove clears the selection', () => {
    // Given
    const id = c.add(line);
    c.select(id);
    // When / Then
    expect(c.remove(id)).toBe(true);
    expect(c.selectedId).toBe('');
    expect(c.items).toHaveLength(0);
    expect(c.remove(id)).toBe(false);
  });
});

describe('setAll / get', () => {
  it('DC7: replaces the list, dropping invalid entries', () => {
    // Given
    c.add({ ...line, id: 'keep' });
    c.select('keep');
    // When
    const count = c.setAll([
      { ...line, id: 'keep' },
      { ...line, id: 'keep' },
      { ...line, id: '' },
      { ...line, id: 'bad', anchors: [] },
      line,
    ]);
    // Then
    expect(count).toBe(2);
    expect(c.items.map((d) => d.id)).toEqual(['keep', 'drawing-1']);
    expect(c.selectedId).toBe('keep');
  });

  it.each([[[]], [null], ['x']])('DC8: %p clears everything', (value) => {
    // Given
    c.add({ ...line, id: 'a' });
    c.select('a');
    // When
    const count = c.setAll(value as unknown as DrawingInput[]);
    // Then
    expect(count).toBe(0);
    expect(c.selectedId).toBe('');
  });

  it('DC9: getters return copies', () => {
    // Given
    const id = c.add(line);
    // When
    const all = c.getAll();
    const one = c.get(id);
    all[0]?.anchors.push({ time: 0, price: 0 });
    // Then
    expect(one).toEqual(c.items[0]);
    expect(c.items[0]?.anchors).toHaveLength(2);
    expect(c.get('nope')).toBeUndefined();
  });
});

describe('selection and tools', () => {
  it('DC10: select', () => {
    // Given
    const id = c.add(line);
    onChange.mockClear();
    // When / Then
    expect(c.select(id)).toBe(true);
    expect(c.select(id)).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(c.select(null)).toBe(true);
    expect(c.selectedId).toBe('');
    expect(c.select('nope')).toBe(false);
  });

  it('DC11: setTool', () => {
    // Given
    const id = c.add(line);
    c.select(id);
    onChange.mockClear();
    // When / Then
    expect(c.setTool('rectangle')).toBe(true);
    expect(c.activeTool).toBe('rectangle');
    expect(c.selectedId).toBe('');
    expect(c.setTool('rectangle')).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(c.setTool('circle' as DrawingType)).toBe(false);
    expect(c.setTool(null)).toBe(true);
    expect(c.activeTool).toBe('');
  });

  it('DC12: createFromDraft', () => {
    // Given
    c.setTool('trendLine');
    // When
    const id = c.createFromDraft('trendLine', [1, 10, 2, 20], false);
    // Then
    expect(id).toBe('drawing-1');
    expect(c.selectedId).toBe(id);
    expect(c.activeTool).toBe('');
    // When: keep the tool
    c.setTool('horizontalLine');
    const kept = c.createFromDraft('horizontalLine', [1, 10], true);
    // Then
    expect(kept).toBe('drawing-2');
    expect(c.activeTool).toBe('horizontalLine');
  });

  it.each([[[1, 10, 2]], [[1, NaN, 2, 20]], [[]]])(
    'DC12: invalid draft %p → empty id',
    (anchors) => {
      // Given
      c.setTool('trendLine');
      onChange.mockClear();
      // When / Then
      expect(c.createFromDraft('trendLine', anchors, false)).toBe('');
      expect(onChange).not.toHaveBeenCalled();
      expect(c.activeTool).toBe('trendLine');
    }
  );
});
