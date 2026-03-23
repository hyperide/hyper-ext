/**
 * @file Live SVG preview — writes SVG to file on every graph change
 *
 * Accessed via: preview("file.svg") in REPL or --preview flag
 */

import { writeFileSync } from 'node:fs';

export class PreviewManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: string | null = null;

  constructor(
    readonly filepath: string,
    private debounceMs = 100,
  ) {}

  update(svg: string): void {
    this.pending = svg;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush(): void {
    if (this.pending) {
      writeFileSync(this.filepath, this.pending);
      this.pending = null;
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.pending) this.flush();
  }
}
