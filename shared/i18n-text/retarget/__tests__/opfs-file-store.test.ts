/**
 * @file OpfsFileStore unit tests — the NodePod (in-browser) FileStore over OPFS.
 *
 * Proves the two durability guarantees the FileStore seam (and the SRE note) demand of the OPFS
 * transport, using the in-memory OPFS + Web Locks mock (happy-dom has neither API):
 *   1. read/write/hash round-trip over the OPFS path layout `hyper-nodepod/<projectId>/<path>`.
 *   2. ATOMIC write: a concurrent read during a write never observes torn bytes (the mock commits
 *      on close(), mirroring OPFS swap-on-close).
 *   3. CROSS-TAB lock via Web Locks: a second withLock for the SAME path waits for the first to
 *      release; DISJOINT paths interleave. This is the riskiest assumption the brainstorm flagged —
 *      an in-process mutex would NOT serialize across tabs; navigator.locks does.
 */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { OpfsFileStore } from '../opfs-file-store';
import { MockDirectoryHandle, MockLockManager } from './helpers/opfs-mock';

function makeStore(projectId = 'proj-1') {
  const root = new MockDirectoryHandle();
  const locks = new MockLockManager();
  const store = new OpfsFileStore({
    projectId,
    getRoot: async () => root as unknown as FileSystemDirectoryHandle,
    locks: locks as unknown as LockManager,
  });
  return { store, root, locks };
}

async function seed(store: OpfsFileStore, path: string, content: string) {
  await store.write(path, content);
}

describe('OpfsFileStore — read/write/hash', () => {
  it('writes then reads back the same content (nested path under the project dir)', async () => {
    const { store } = makeStore();
    await seed(store, 'src/Hero.tsx', 'export const x = 1;\n');
    expect(await store.read('src/Hero.tsx')).toBe('export const x = 1;\n');
  });

  it('write replaces existing content', async () => {
    const { store } = makeStore();
    await seed(store, 'a.txt', 'old');
    await store.write('a.txt', 'new');
    expect(await store.read('a.txt')).toBe('new');
  });

  it('read rejects for an absent file', async () => {
    const { store } = makeStore();
    await expect(store.read('missing.txt')).rejects.toThrow();
  });

  it('rejects a path-traversal segment (cannot escape the project tree)', async () => {
    const { store } = makeStore();
    await expect(store.read('../other-proj/secret.txt')).rejects.toThrow(/traversal/);
    await expect(store.write('a/../../escape.txt', 'x')).rejects.toThrow(/traversal/);
  });

  it('hash is content-derived sha256, byte-identical to NodeFileStore semantics', async () => {
    const { store } = makeStore();
    await seed(store, 'a.txt', 'content');
    const expected = createHash('sha256').update('content').digest('hex');
    expect(await store.hash('a.txt')).toBe(expected);
  });
});

describe('OpfsFileStore — atomic write (no torn read)', () => {
  it('a read concurrent with a write sees either the whole old or whole new content', async () => {
    const { store } = makeStore();
    await seed(store, 'a.txt', 'AAAA');

    // Kick off a write and, without awaiting it, immediately read. The mock commits on close(),
    // so the interleaved read must observe a COMPLETE value, never a partial mix.
    const writeP = store.write('a.txt', 'BBBBBBBB');
    const midRead = await store.read('a.txt');
    await writeP;
    const finalRead = await store.read('a.txt');

    expect(['AAAA', 'BBBBBBBB']).toContain(midRead); // whole-or-nothing
    expect(finalRead).toBe('BBBBBBBB');
  });
});

describe('OpfsFileStore — cross-tab lock via Web Locks', () => {
  it('serializes withLock on the SAME path (second waits for the first to release)', async () => {
    const { store } = makeStore();
    const order: string[] = [];
    const slow = store.withLock(['src/Hero.tsx'], async () => {
      order.push('A-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('A-end');
    });
    const fast = store.withLock(['src/Hero.tsx'], async () => {
      order.push('B-start');
      order.push('B-end');
    });
    await Promise.all([slow, fast]);
    // B must not start until A released the path lock — this is the cross-tab serialization.
    expect(order).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
  });

  it('allows DISJOINT paths to interleave', async () => {
    const { store } = makeStore();
    const order: string[] = [];
    const a = store.withLock(['x.tsx'], async () => {
      order.push('A-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('A-end');
    });
    const b = store.withLock(['y.tsx'], async () => {
      order.push('B-start');
      order.push('B-end');
    });
    await Promise.all([a, b]);
    expect(order.indexOf('B-end')).toBeLessThan(order.indexOf('A-end'));
  });

  it('multi-path sets that OVERLAP run mutually exclusive (critical sections never interleave)', async () => {
    const { store } = makeStore();
    const order: string[] = [];
    // A locks {shared, other}; B locks {shared}. They share "shared.tsx", so their critical
    // sections must NEVER overlap, regardless of which wins the race for the shared lock. We assert
    // non-overlap (the real guarantee) rather than a fixed winner — navigator.locks gives the lock
    // to whoever requests it first, which is an inherent race, not a property under test.
    const a = store.withLock(['shared.tsx', 'other.tsx'], async () => {
      order.push('A-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('A-end');
    });
    const b = store.withLock(['shared.tsx'], async () => {
      order.push('B-start');
      await new Promise((r) => setTimeout(r, 5));
      order.push('B-end');
    });
    await Promise.all([a, b]);
    // Whichever started first must have ended before the other started — no interleave.
    const aStart = order.indexOf('A-start');
    const bStart = order.indexOf('B-start');
    if (aStart < bStart) {
      expect(order).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
    } else {
      expect(order).toEqual(['B-start', 'B-end', 'A-start', 'A-end']);
    }
  });
});
