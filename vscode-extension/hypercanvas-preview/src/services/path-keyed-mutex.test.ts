/**
 * @file HYP-990 (M2) — PathKeyedMutex unit tests. Proves the serialization contract the
 * non-forwarding style-write saga relies on: same-key runs are strictly sequential (no
 * interleaving), different-key runs are concurrent, and a throwing critical section still
 * releases the lock.
 */
import { describe, expect, it } from 'bun:test';
import { PathKeyedMutex } from './path-keyed-mutex';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('PathKeyedMutex', () => {
  it('serializes same-key sections — no interleaving', async () => {
    const mutex = new PathKeyedMutex();
    const events: string[] = [];

    const section = (id: string) =>
      mutex.runExclusive('file.tsx', async () => {
        events.push(`${id}:enter`);
        await tick();
        events.push(`${id}:exit`);
      });

    await Promise.all([section('A'), section('B'), section('C')]);

    // Each section's enter is immediately followed by its own exit — never A:enter, B:enter.
    expect(events).toEqual(['A:enter', 'A:exit', 'B:enter', 'B:exit', 'C:enter', 'C:exit']);
  });

  it('runs different keys concurrently', async () => {
    const mutex = new PathKeyedMutex();
    let bothInside = false;
    let aInside = false;

    const a = mutex.runExclusive('a.tsx', async () => {
      aInside = true;
      await tick();
      aInside = false;
    });
    const b = mutex.runExclusive('b.tsx', async () => {
      // If keys did NOT run concurrently, `a` would already have exited before `b` starts.
      if (aInside) bothInside = true;
    });

    await Promise.all([a, b]);
    expect(bothInside).toBe(true);
  });

  it('preserves FIFO order among same-key waiters', async () => {
    const mutex = new PathKeyedMutex();
    const order: number[] = [];
    const tasks = [0, 1, 2, 3, 4].map((n) =>
      mutex.runExclusive('same', async () => {
        await tick();
        order.push(n);
      }),
    );
    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('releases the lock when a section throws, so later waiters still run', async () => {
    const mutex = new PathKeyedMutex();
    const ran: string[] = [];

    const failing = mutex.runExclusive('file.tsx', async () => {
      ran.push('failing');
      throw new Error('boom');
    });
    const after = mutex.runExclusive('file.tsx', async () => {
      ran.push('after');
    });

    await expect(failing).rejects.toThrow('boom');
    await after;
    expect(ran).toEqual(['failing', 'after']);
  });

  it('propagates the section return value', async () => {
    const mutex = new PathKeyedMutex();
    const result = await mutex.runExclusive('k', async () => 42);
    expect(result).toBe(42);
  });
});
