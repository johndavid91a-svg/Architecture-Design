/**
 * Undo / redo.
 *
 * Because every edit operation is pure and returns a new architecture layer,
 * history is just a list of snapshots. A command-pattern implementation with
 * inverse operations would use less memory and would be considerably easier to
 * get subtly wrong — an inverse that is not quite the inverse corrupts the twin
 * in a way the user only discovers later, in a quantity.
 *
 * Memory is not a real constraint here. A floor of fifty rooms serialises to a
 * few hundred kilobytes, and the stack is bounded.
 */

export interface HistoryEntry<T> {
  readonly state: T;
  readonly description: string;
  readonly at: string;
}

const DEFAULT_LIMIT = 100;

export class History<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private current: HistoryEntry<T>;

  constructor(
    initial: T,
    description = 'Initial state',
    private readonly limit = DEFAULT_LIMIT,
  ) {
    this.current = { state: initial, description, at: new Date().toISOString() };
  }

  get state(): T {
    return this.current.state;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** What undo would reverse, for the menu label. */
  get undoLabel(): string | null {
    return this.current.description;
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.description ?? null;
  }

  push(state: T, description: string): void {
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    // A new edit invalidates the redo branch. Keeping it would let the user
    // redo forward into a state that no longer follows from the present.
    this.future = [];
    this.current = { state, description, at: new Date().toISOString() };
  }

  undo(): T | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(this.current);
    this.current = previous;
    return this.current.state;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    return this.current.state;
  }

  /** Replace the whole history, e.g. after loading a different project. */
  reset(state: T, description = 'Loaded'): void {
    this.past = [];
    this.future = [];
    this.current = { state, description, at: new Date().toISOString() };
  }

  get depth(): { past: number; future: number } {
    return { past: this.past.length, future: this.future.length };
  }
}
