/**
 * @file Tests for the provenance-safe / own-fiber source-map resolution behind
 * getMappedSourceLocation (HYP-49). Decorative drag resolution must:
 *   (1) NEVER attribute a fiber to an ANCESTOR's source when its own frame is cold
 *       (resolveOwnClientSourceMap must not walk `.return`, unlike resolveViaClientSourceMap), and
 *   (2) fail safe on a cold own source map (no raw `_debugStack` line).
 *
 * These tests drive the REAL `iframe-source-maps` functions against the real
 * `clientSourceMapCache` (no module mocking — which bun intercepts unreliably for
 * these specifiers), so they exercise production behavior, not a stub.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Fiber } from '@shared/element-tracing/fiber-internals';
import { clientSourceMapCache, resolveOwnClientSourceMap, resolveViaClientSourceMap } from '../iframe-source-maps';

// Build a React-19-style fiber whose _debugStack has a single Vite client frame at
// `url:line:col`, optionally chained to a parent fiber via `.return`.
function makeFiberWithFrame(url: string, line: number, col: number, ret: Fiber | null = null): Fiber {
  const stack = new Error();
  stack.stack = `Error\n    at ${url}:${line}:${col}`;
  return {
    tag: 5,
    type: 'div',
    stateNode: null,
    return: ret,
    child: null,
    sibling: null,
    memoizedProps: {},
    _debugSource: null,
    _debugStack: stack,
    _debugOwner: null,
  } as unknown as Fiber;
}

const PARENT_URL = 'http://localhost:5173/src/components/TestElements.tsx';
const ANCESTOR_URL = 'http://localhost:5173/src/components/Unrelated.tsx';

beforeEach(() => {
  clientSourceMapCache.clear();
});
afterEach(() => {
  clientSourceMapCache.clear();
});

describe('resolveOwnClientSourceMap (own-fiber, never walks .return)', () => {
  test('parent frame COLD + ancestor frame WARM → own lookup returns undefined (no ancestor leak)', () => {
    // Ancestor frame is warm/cached; parent frame is NOT in the cache (cold).
    clientSourceMapCache.set(`${ANCESTOR_URL}:7:2`, { fileName: 'src/components/Unrelated.tsx', line: 7, column: 1 });

    const ancestor = makeFiberWithFrame(ANCESTOR_URL, 7, 2);
    const parent = makeFiberWithFrame(PARENT_URL, 443, 32, ancestor);

    // Own-fiber lookup: parent's own frame is uncached → undefined (warm-up in flight),
    // NEVER the ancestor's cached source.
    expect(resolveOwnClientSourceMap(parent).resolved).toBeUndefined();

    // Contrast: the ancestor-walking resolver DOES return the ancestor source — exactly
    // the wrong-element attribution the own-fiber path must avoid for decorative drags.
    expect(resolveViaClientSourceMap(parent)).toEqual({ fileName: 'src/components/Unrelated.tsx', line: 7, column: 1 });
  });

  test('own frame WARM → returns the mapped source location', () => {
    const mapped = { fileName: 'src/components/TestElements.tsx', line: 179, column: 8 };
    clientSourceMapCache.set(`${PARENT_URL}:443:32`, mapped);
    const parent = makeFiberWithFrame(PARENT_URL, 443, 32);
    expect(resolveOwnClientSourceMap(parent).resolved).toEqual(mapped);
  });

  test('own frame warmed-but-unresolvable (null) → returns null (definitive miss), does not walk', () => {
    clientSourceMapCache.set(`${ANCESTOR_URL}:7:2`, { fileName: 'src/components/Unrelated.tsx', line: 7, column: 1 });
    clientSourceMapCache.set(`${PARENT_URL}:443:32`, null); // warmed, no mapping
    const ancestor = makeFiberWithFrame(ANCESTOR_URL, 7, 2);
    const parent = makeFiberWithFrame(PARENT_URL, 443, 32, ancestor);
    expect(resolveOwnClientSourceMap(parent).resolved).toBeNull();
  });

  test('fiber with no _debugStack → undefined', () => {
    const bare = { _debugStack: null, return: null } as unknown as Fiber;
    expect(resolveOwnClientSourceMap(bare).resolved).toBeUndefined();
  });
});
