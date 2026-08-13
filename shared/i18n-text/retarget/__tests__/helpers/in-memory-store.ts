/**
 * @file Shared in-memory FileStore for retarget tests. One implementation so the orchestrator and
 *   parity suites can't drift on hash semantics (parity asserts byte-equality with NodeFileStore,
 *   so this MUST use the same sha256 NodeFileStore uses — a hand-rolled hash would break parity).
 */
import { createHash } from 'node:crypto';
import type { FileStore } from '../../file-store';

export interface InMemoryStore extends FileStore {
  /** Synchronous peek for assertions. Throws if absent. */
  dump(path: string): string;
}

export function memStore(initial: Record<string, string>): InMemoryStore {
  const files = new Map(Object.entries(initial));
  return {
    async read(p) {
      const c = files.get(p);
      if (c === undefined) throw new Error(`ENOENT ${p}`);
      return c;
    },
    async write(p, content) {
      files.set(p, content);
    },
    async hash(p) {
      return createHash('sha256')
        .update(files.get(p) ?? '')
        .digest('hex');
    },
    async withLock(_paths, fn) {
      return fn();
    },
    dump(p) {
      const c = files.get(p);
      if (c === undefined) throw new Error(`ENOENT ${p}`);
      return c;
    },
  };
}
