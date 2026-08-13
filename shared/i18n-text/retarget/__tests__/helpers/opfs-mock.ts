/**
 * @file In-memory OPFS + Web Locks mock for OpfsFileStore tests.
 *
 * Why this exists: happy-dom (the repo's test DOM) provides NEITHER
 * `navigator.storage.getDirectory()` (the OPFS root) NOR `navigator.locks` (Web Locks). So an
 * OpfsFileStore test can't run against a real browser FS. This mock models exactly the slice of
 * both APIs OpfsFileStore touches:
 *   - FileSystemDirectoryHandle: getDirectoryHandle / getFileHandle (create), removeEntry,
 *     async-iteration over [name, handle] entries.
 *   - FileSystemFileHandle: getFile().text(), createWritable() → write/close. close() is the
 *     ATOMIC COMMIT point — partial bytes written before close() are NOT visible to a concurrent
 *     getFile(), mirroring OPFS's swap-on-close semantics (this is what lets the parity/atomicity
 *     tests prove torn-read-freedom without a real browser).
 *   - LockManager.request(name, opts, fn): an exclusive, per-name async lock that serializes
 *     overlapping requests — the SAME contract navigator.locks gives across tabs, modeled here
 *     in-process so the serialization test is deterministic.
 *
 * It is deliberately NOT a general OPFS polyfill; it implements only what OpfsFileStore calls.
 */

interface MockFile {
  /** Committed content — only updated on writable.close(), never mid-write. */
  content: string;
}

class MockWritable {
  private buffer = '';
  constructor(private readonly file: MockFile) {}

  async write(data: string): Promise<void> {
    // Accumulate into a private buffer; the live file is untouched until close() commits.
    this.buffer += data;
  }

  async close(): Promise<void> {
    // Atomic commit: a concurrent getFile() before this line sees the OLD content, after it the
    // NEW — never a half-written mix. This is the torn-read-freedom OPFS gives via swap-on-close.
    this.file.content = this.buffer;
  }

  async abort(): Promise<void> {
    // Discard the buffer; the live file keeps its prior content.
    this.buffer = '';
  }
}

export class MockFileHandle {
  readonly kind = 'file' as const;
  constructor(
    readonly name: string,
    private readonly file: MockFile,
  ) {}

  async getFile(): Promise<{ text(): Promise<string> }> {
    const snapshot = this.file.content;
    return { text: async () => snapshot };
  }

  async createWritable(): Promise<MockWritable> {
    return new MockWritable(this.file);
  }
}

export class MockDirectoryHandle {
  readonly kind = 'directory' as const;
  private readonly dirs = new Map<string, MockDirectoryHandle>();
  private readonly files = new Map<string, MockFileHandle>();
  private readonly fileData = new Map<string, MockFile>();

  constructor(readonly name = '') {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDirectoryHandle> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMExceptionLike('NotFoundError', name);
      d = new MockDirectoryHandle(name);
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MockFileHandle> {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) throw new DOMExceptionLike('NotFoundError', name);
      const data: MockFile = { content: '' };
      this.fileData.set(name, data);
      f = new MockFileHandle(name, data);
      this.files.set(name, f);
    }
    return f;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) this.dirs.delete(name);
    this.fileData.delete(name);
  }

  // Async iteration over [name, handle] entries (used by readDir-style traversal, if ever).
  async *entries(): AsyncIterableIterator<[string, MockDirectoryHandle | MockFileHandle]> {
    for (const [n, h] of this.dirs) yield [n, h];
    for (const [n, h] of this.files) yield [n, h];
  }

  [Symbol.asyncIterator]() {
    return this.entries();
  }
}

class DOMExceptionLike extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/**
 * Minimal LockManager mock matching the slice OpfsFileStore uses: request(name, { mode }, fn) where
 * overlapping same-name exclusive requests serialize. Disjoint names proceed in parallel. Mirrors
 * navigator.locks.request's "the lock is held for the duration of the callback's promise" contract.
 */
export class MockLockManager {
  private readonly tails = new Map<string, Promise<unknown>>();

  request<T>(
    name: string,
    optionsOrFn: { mode?: string } | (() => Promise<T>),
    maybeFn?: () => Promise<T>,
  ): Promise<T> {
    const fn = (typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn) as () => Promise<T>;
    const predecessor = this.tails.get(name) ?? Promise.resolve();
    const run = predecessor.then(() => fn());
    // The tail must not reject the chain; swallow so a failed holder doesn't deadlock the next.
    this.tails.set(
      name,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}
