import {
  cloneDrawing,
  createDrawing,
  isDrawingType,
  patchDrawing,
  type Drawing,
  type DrawingInput,
  type DrawingPatch,
  type DrawingType,
} from './DrawingModel';

/**
 * Drawings (in z-order, last on top), the active drawing tool and the
 * selection. JS-thread source of truth; `onChange` fires after every
 * effective change (the store recompiles the scene and notifies hosts).
 * Pure TypeScript.
 */
export class DrawingCollection {
  private list: Drawing[] = [];
  private tool: DrawingType | '' = '';
  private selected = '';
  private nextId = 1;

  constructor(private readonly onChange: () => void) {}

  get items(): readonly Drawing[] {
    return this.list;
  }

  get activeTool(): DrawingType | '' {
    return this.tool;
  }

  get selectedId(): string {
    return this.selected;
  }

  private indexOf(id: string): number {
    return this.list.findIndex((d) => d.id === id);
  }

  private generateId(): string {
    let id: string;
    do {
      id = `drawing-${this.nextId++}`;
    } while (this.indexOf(id) >= 0);
    return id;
  }

  /** Adds a drawing on top. Throws on invalid input or a duplicate id. */
  add(input: DrawingInput): string {
    const id = input.id ?? this.generateId();
    if (typeof id !== 'string' || id === '' || this.indexOf(id) >= 0) {
      throw new Error(`Invalid or duplicate drawing id "${String(id)}"`);
    }
    const drawing = createDrawing(id, input);
    if (drawing === null) {
      throw new Error(`Invalid drawing "${id}" (type or anchors)`);
    }
    this.list = [...this.list, drawing];
    this.onChange();
    return id;
  }

  update(id: string, patch: DrawingPatch): boolean {
    const i = this.indexOf(id);
    if (i < 0) {
      return false;
    }
    const next = patchDrawing(this.list[i] as Drawing, patch);
    if (next === null) {
      return false;
    }
    this.list = this.list.map((d, j) => (j === i ? next : d));
    this.onChange();
    return true;
  }

  remove(id: string): boolean {
    const i = this.indexOf(id);
    if (i < 0) {
      return false;
    }
    this.list = this.list.filter((_, j) => j !== i);
    if (this.selected === id) {
      this.selected = '';
    }
    this.onChange();
    return true;
  }

  /** Replaces every drawing; invalid / duplicate entries are dropped. */
  setAll(inputs: readonly DrawingInput[]): number {
    const next: Drawing[] = [];
    const seen = new Set<string>();
    for (const input of Array.isArray(inputs) ? inputs : []) {
      const id = input?.id === undefined ? this.generateId() : String(input.id);
      const drawing =
        id !== '' && !seen.has(id) ? createDrawing(id, input) : null;
      if (drawing !== null) {
        seen.add(id);
        next.push(drawing);
      }
    }
    this.list = next;
    if (!seen.has(this.selected)) {
      this.selected = '';
    }
    this.onChange();
    return next.length;
  }

  getAll(): Drawing[] {
    return this.list.map(cloneDrawing);
  }

  get(id: string): Drawing | undefined {
    const i = this.indexOf(id);
    return i < 0 ? undefined : cloneDrawing(this.list[i] as Drawing);
  }

  /** Selects a drawing (`null` / `''` clears). `false` for unknown ids. */
  select(id: string | null): boolean {
    const next = id ?? '';
    if (next !== '' && this.indexOf(next) < 0) {
      return false;
    }
    if (next !== this.selected) {
      this.selected = next;
      this.onChange();
    }
    return true;
  }

  /** Activates a tool (`null` = off). Clears the selection. */
  setTool(tool: DrawingType | null): boolean {
    if (tool !== null && !isDrawingType(tool)) {
      return false;
    }
    const next = tool ?? '';
    if (next !== this.tool || (next !== '' && this.selected !== '')) {
      this.tool = next;
      if (next !== '') {
        this.selected = '';
      }
      this.onChange();
    }
    return true;
  }

  /**
   * Creates the drawing finished by the user's taps (UI thread → JS):
   * selects it and turns the tool off unless `keepTool`. Invalid anchors
   * (e.g. a stale draft) are ignored (`''`).
   */
  createFromDraft(
    type: DrawingType,
    anchors: readonly number[],
    keepTool: boolean
  ): string {
    const points = [];
    for (let i = 0; i + 1 < anchors.length; i += 2) {
      points.push({
        time: anchors[i] as number,
        price: anchors[i + 1] as number,
      });
    }
    const id = this.generateId();
    const drawing = createDrawing(id, { type, anchors: points });
    if (drawing === null) {
      return '';
    }
    this.list = [...this.list, drawing];
    this.selected = id;
    if (!keepTool) {
      this.tool = '';
    }
    this.onChange();
    return id;
  }
}
