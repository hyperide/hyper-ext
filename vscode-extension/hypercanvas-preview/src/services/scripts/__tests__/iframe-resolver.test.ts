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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Fiber } from '@shared/element-tracing/fiber-internals';
import { clientSourceMapCache, resolveOwnClientSourceMap, resolveViaClientSourceMap } from '../iframe-source-maps';
import { createIframeResolver, mapOwnFiberSource } from '../iframe-resolver';

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

describe('call-site mapper: distinguishes COLD (warm it) from definitive NULL (skip) — HYP-970 / Codex P1', () => {
  const LEAF_URL = 'http://localhost:5173/src/components/Tweet.tsx';
  const CALLSITE_URL = 'http://localhost:5173/src/components/Feed.tsx';

  function attach(el: object, fiber: Fiber): HTMLElement {
    (el as Record<'__reactFiber$test', Fiber>).__reactFiber$test = fiber;
    return el as HTMLElement;
  }

  function makeCtxWithSpies() {
    const warmedServer: Fiber[] = [];
    const warmedFiber: Fiber[] = [];
    const ctx = {
      renderedComponentPath: 'src/App.tsx',
      pendingClickElement: null as HTMLElement | null,
      pendingClickTimestamp: { value: 0 },
      warmServerChunkFrames: (f: Fiber) => warmedServer.push(f),
      warmFiberChunkFrames: (f: Fiber) => warmedFiber.push(f),
    };
    return { ctx, warmedServer, warmedFiber };
  }

  test('COLD call-site ancestor (undefined) → mapper WARMS it and the walk keeps the valid leaf source, never a compiled line', () => {
    // Leaf (clicked <div> inside <Tweet>) resolves warm to its own Tweet.tsx source.
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: 'src/components/Tweet.tsx', line: 20, column: 3 });
    // The <Tweet> call-site frame in Feed.tsx is NOT cached (cold / never warmed).
    const callSite = makeFiberWithFrame(CALLSITE_URL, 65, 84); // Feed.tsx:65:84 (compiled, uncached)
    const leaf = makeFiberWithFrame(LEAF_URL, 100, 15, callSite);

    const { ctx, warmedServer, warmedFiber } = makeCtxWithSpies();
    const resolver = createIframeResolver(ctx);
    const loc = resolver.getSourceLocation(attach({}, leaf));

    // The cold call-site ancestor was WARMED (both server + client frames kicked off)…
    expect(warmedFiber).toContain(callSite);
    expect(warmedServer).toContain(callSite);
    // …and, still cold this pass, the result is the valid leaf source — NEVER the compiled
    // Feed.tsx:65:84 (parseDebugStack) line that AstService can't resolve.
    expect(loc).toEqual({ fileName: 'src/components/Tweet.tsx', line: 20, column: 3 });
  });

  test('definitive-NULL call-site ancestor (warmed, unmappable) → mapper does NOT warm, just skips', () => {
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: 'src/components/Tweet.tsx', line: 20, column: 3 });
    clientSourceMapCache.set(`${CALLSITE_URL}:65:84`, null); // warmed, no mapping → definitive miss
    const callSite = makeFiberWithFrame(CALLSITE_URL, 65, 84);
    const leaf = makeFiberWithFrame(LEAF_URL, 100, 15, callSite);

    const { ctx, warmedServer, warmedFiber } = makeCtxWithSpies();
    const resolver = createIframeResolver(ctx);
    const loc = resolver.getSourceLocation(attach({}, leaf));

    // A definitive miss is NOT re-warmed (no point) — it is simply skipped.
    expect(warmedFiber).not.toContain(callSite);
    expect(warmedServer).not.toContain(callSite);
    expect(loc).toEqual({ fileName: 'src/components/Tweet.tsx', line: 20, column: 3 });
  });

  test('resolveClickLocal keeps the valid LEAF source (never a wrong ancestor / compiled line) while the call-site is COLD, and warms it', () => {
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: 'src/components/Tweet.tsx', line: 20, column: 3 });
    // <Tweet> call site in Feed is cold — never warmed.
    const callSite = makeFiberWithFrame(CALLSITE_URL, 65, 84);
    const leaf = makeFiberWithFrame(LEAF_URL, 100, 15, callSite);

    const { ctx, warmedFiber } = makeCtxWithSpies();
    const resolver = createIframeResolver(ctx);
    const result = resolver.resolveClickLocal(attach({}, leaf));

    // Commits the element's own valid leaf source — NEVER a wrong container or the compiled
    // Feed.tsx:65:84 line. resolveClickLocal is side-effect-free for hover reuse: no pending
    // click is registered.
    expect(result?.nodeRef).toBe('src/components/Tweet.tsx:20:3');
    expect(ctx.pendingClickElement).toBeNull();
    // The cold call-site frame was warmed so the NEXT pass resolves the true call site.
    expect(warmedFiber).toContain(callSite);
  });

  test('resolveClickLocal commits the TRUE call site (Feed.tsx) once the call-site frame is WARM', () => {
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: 'src/components/Tweet.tsx', line: 20, column: 3 });
    // <Tweet> call site now resolves to its ORIGINAL Feed.tsx position (line 46, not compiled 65).
    clientSourceMapCache.set(`${CALLSITE_URL}:65:84`, { fileName: 'src/components/Feed.tsx', line: 46, column: 10 });
    const callSite = makeFiberWithFrame(CALLSITE_URL, 65, 84);
    const leaf = makeFiberWithFrame(LEAF_URL, 100, 15, callSite);

    const { ctx } = makeCtxWithSpies();
    const resolver = createIframeResolver(ctx);
    const result = resolver.resolveClickLocal(attach({}, leaf));

    expect(result?.nodeRef).toBe('src/components/Feed.tsx:46:10');
    expect(ctx.pendingClickElement).toBeNull();
  });

  test('an ancestor with NO unresolved frame (definitive/frameless) is SKIPPED, not treated as cold — walk reaches the warm call site (Codex P1 #3)', () => {
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: 'src/components/Tweet.tsx', line: 20, column: 3 });
    clientSourceMapCache.set(`${CALLSITE_URL}:65:84`, { fileName: 'src/components/Feed.tsx', line: 46, column: 10 });
    // Intermediate component fiber with NO source frame (e.g. a server-only/definitive miss):
    // must NOT be treated as cold-forever, or the walk would discard the warm Feed call site.
    const callSite = makeFiberWithFrame(CALLSITE_URL, 65, 84);
    const frameless = { ...makeFiberWithFrame(LEAF_URL, 0, 0), _debugStack: null, tag: 0, return: callSite } as Fiber;
    const leaf = makeFiberWithFrame(LEAF_URL, 100, 15, frameless);

    const { ctx } = makeCtxWithSpies();
    const resolver = createIframeResolver(ctx);
    const result = resolver.resolveClickLocal(attach({}, leaf));

    // Walked PAST the frameless ancestor to the WARM Feed call site — not stuck on the leaf.
    expect(result?.nodeRef).toBe('src/components/Feed.tsx:46:10');
  });
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

/**
 * Parity guard (HYP-970): the extension's iframe click/hover entry points must pass a REAL
 * own-fiber source-map mapper into the shared call-site walk-up. `resolveCallSiteTarget` /
 * `resolveCallSiteSource` take the mapper as an optional trailing arg and fall back to raw
 * `parseDebugStack` when it is omitted — which under React 19 + Vite commits a COMPILED
 * `_debugStack` line and makes AstService fail with "Element not found". This guards both that
 * `mapOwnFiberSource` is itself a real mapper (resolves a warm own-fiber source, returns null
 * when cold — never a stub) AND that the two `iframe-interaction.ts` call sites still pass it,
 * so a future drop of the mapper arg is caught here instead of in production.
 */
describe('parity guard: iframe entry points wire mapOwnFiberSource (HYP-970)', () => {
  const OWN_URL = 'http://localhost:5173/src/components/Own.tsx';

  test('mapOwnFiberSource resolves a warm own-fiber source (real mapper, not a no-op)', () => {
    clientSourceMapCache.set(`${OWN_URL}:100:15`, { fileName: 'src/components/Own.tsx', line: 12, column: 4 });
    const fiber = makeFiberWithFrame(OWN_URL, 100, 15);
    expect(mapOwnFiberSource(fiber)).toEqual({ fileName: 'src/components/Own.tsx', line: 12, column: 4 });
  });

  test('mapOwnFiberSource returns null when the own frame is cold (never a raw compiled line)', () => {
    const fiber = makeFiberWithFrame(OWN_URL, 100, 15);
    expect(mapOwnFiberSource(fiber)).toBeNull();
  });

  test('iframe-interaction.ts passes mapOwnFiberSource to resolveCallSiteTarget AND resolveCallSiteSource', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'iframe-interaction.ts'), 'utf8');
    // Bind each assertion to the call itself (up to its terminating `)`): dropping the trailing
    // mapper arg leaves `resolveCallSiteTarget(source, fiber, renderedComponentPath, directItemIndex)`
    // — no mapOwnFiberSource inside the arg list → this fails.
    expect(src).toMatch(/resolveCallSiteTarget\s*\([^)]*mapOwnFiberSource\s*\)/);
    expect(src).toMatch(/resolveCallSiteSource\s*\([^)]*mapOwnFiberSource\s*\)/);
  });
});
