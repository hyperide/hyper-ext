/**
 * @file Auto-save — debounced persistence trigger
 *
 * Accessed via: Every graph mutation triggers debounced save
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Undo/Redo Persistence
 */

export class AutoSave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private saveFn: () => Promise<void>,
    private debounceMs: number = 500,
  ) {}

  markDirty(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.saveFn();
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
