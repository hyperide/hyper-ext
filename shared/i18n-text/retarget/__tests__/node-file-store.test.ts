/**
 * @file NodeFileStore unit tests over real disk: atomic write, hash, and the withLock mutex
 *   actually serializing overlapping-path operations while letting disjoint ones interleave.
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileStore } from '../node-file-store';

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'retarget-nfs-'));
}

describe('NodeFileStore', () => {
  it('read returns file content', async () => {
    const dir = await scratch();
    const f = join(dir, 'a.txt');
    await writeFile(f, 'hello', 'utf-8');
    const store = new NodeFileStore();
    expect(await store.read(f)).toBe('hello');
  });

  it('write atomically replaces content and leaves no temp file behind', async () => {
    const dir = await scratch();
    const f = join(dir, 'a.txt');
    await writeFile(f, 'old', 'utf-8');
    const store = new NodeFileStore();
    await store.write(f, 'new');
    expect(await readFile(f, 'utf-8')).toBe('new');
    // No leftover temp files.
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir);
    expect(entries).toEqual(['a.txt']);
  });

  it('hash is content-derived and stable', async () => {
    const dir = await scratch();
    const f = join(dir, 'a.txt');
    await writeFile(f, 'content', 'utf-8');
    const store = new NodeFileStore();
    const h1 = await store.hash(f);
    const h2 = await store.hash(f);
    expect(h1).toBe(h2);
    await store.write(f, 'changed');
    expect(await store.hash(f)).not.toBe(h1);
  });

  it('withLock serializes operations on the SAME path (no interleave)', async () => {
    const store = new NodeFileStore();
    const order: string[] = [];
    const slow = store.withLock(['/x'], async () => {
      order.push('A-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('A-end');
    });
    const fast = store.withLock(['/x'], async () => {
      order.push('B-start');
      order.push('B-end');
    });
    await Promise.all([slow, fast]);
    // B must not start until A finished — same path serializes.
    expect(order).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
  });

  it('withLock allows DISJOINT paths to interleave', async () => {
    const store = new NodeFileStore();
    const order: string[] = [];
    const a = store.withLock(['/x'], async () => {
      order.push('A-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('A-end');
    });
    const b = store.withLock(['/y'], async () => {
      order.push('B-start');
      order.push('B-end');
    });
    await Promise.all([a, b]);
    // B (disjoint path) runs while A is sleeping — B finishes before A.
    expect(order.indexOf('B-end')).toBeLessThan(order.indexOf('A-end'));
  });
});
