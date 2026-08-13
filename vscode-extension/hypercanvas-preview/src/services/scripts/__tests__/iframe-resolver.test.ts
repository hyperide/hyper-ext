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
  // Post-HYP-1006 the call-site walk only runs for a NON-EDITABLE (node_modules) primitive
  // internal — an editable leaf resolves to its own source without walking. So the clicked
  // leaf here is the internal host of a node_modules <Button>: its served chunk frame is a
  // `/src/` URL (what extractClientChunkFrames keys on), but its SOURCE-MAP-resolved file is
  // a node_modules path (LEAF_FILE) — non-editable, so the walk collapses to the <Button/>
  // call site (<Button/> in Feed.tsx). (An editable leaf never reaches this walk.)
  const LEAF_URL = 'http://localhost:5173/src/deps/acme-ui-button.js';
  const LEAF_FILE = 'node_modules/@acme/ui/dist/button.js';
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
      pendingClickElement: { current: null as HTMLElement | null },
      pendingClickTimestamp: { value: 0 },
      warmServerChunkFrames: (f: Fiber) => warmedServer.push(f),
      warmFiberChunkFrames: (f: Fiber) => warmedFiber.push(f),
    };
    return { ctx, warmedServer, warmedFiber };
  }

  test('COLD call-site ancestor (undefined) → mapper WARMS it and the walk keeps the valid leaf source, never a compiled line', () => {
    // Leaf (clicked host node inside a node_modules <Button>) resolves warm to its own source.
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: LEAF_FILE, line: 20, column: 3 });
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
    expect(loc).toEqual({ fileName: LEAF_FILE, line: 20, column: 3 });
  });

  test('definitive-NULL call-site ancestor (warmed, unmappable) → mapper does NOT warm, just skips', () => {
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: LEAF_FILE, line: 20, column: 3 });
    clientSourceMapCache.set(`${CALLSITE_URL}:65:84`, null); // warmed, no mapping → definitive miss
    const callSite = makeFiberWithFrame(CALLSITE_URL, 65, 84);
    const leaf = makeFiberWithFrame(LEAF_URL, 100, 15, callSite);

    const { ctx, warmedServer, warmedFiber } = makeCtxWithSpies();
    const resolver = createIframeResolver(ctx);
    const loc = resolver.getSourceLocation(attach({}, leaf));

    // A definitive miss is NOT re-warmed (no point) — it is simply skipped.
    expect(warmedFiber).not.toContain(callSite);
    expect(warmedServer).not.toContain(callSite);
    expect(loc).toEqual({ fileName: LEAF_FILE, line: 20, column: 3 });
  });

  test('resolveClickLocal DEFERS a NON-editable (node_modules) leaf while the call-site is COLD, and warms it (HYP-1006)', () => {
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: LEAF_FILE, line: 20, column: 3 });
    // <Button> call site in Feed is cold — never warmed.
    const callSite = makeFiberWithFrame(CALLSITE_URL, 65, 84);
    const leaf = makeFiberWithFrame(LEAF_URL, 100, 15, callSite);

    const { ctx, warmedFiber } = makeCtxWithSpies();
    const resolver = createIframeResolver(ctx);
    const result = resolver.resolveClickLocal(attach({}, leaf));

    // The leaf is a node_modules dependency internal — committing it would target uneditable code
    // whose style writes fail. Since the editable call site is only COLD (not gone), defer to the
    // warm-retry (which re-resolves once the frame warms) instead of committing the node_modules
    // path. (An EDITABLE leaf still keeps its own valid source — see the resolveClickLocal-LEAF-seed
    // suite below, which uses a first-party App.tsx leaf.)
    expect(result).toBeNull();
    expect(ctx.pendingClickElement.current).not.toBeNull(); // deferred → pending registered
    // The cold call-site frame was warmed so the NEXT pass resolves the true call site.
    expect(warmedFiber).toContain(callSite);
  });

  test('resolveClickLocal does NOT register a pending click for a DEFINITIVE (non-cold) non-editable miss — no hover side effect (HYP-1006)', () => {
    // The call site is WARM but definitively unmappable (cached null) — NOT cold, so waiting can
    // never improve it. Deferring here would be wrong on two counts: (1) it can never resolve to
    // anything better (a permanently "pending" click), and (2) resolveClickLocal is reused for
    // HOVER (shared click-handler's handleMouseOver) — registering a pending click as a side
    // effect of merely hovering over an unresolvable node_modules primitive could later commit a
    // selection the user never clicked. Must return null WITHOUT touching pendingClickElement.
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: LEAF_FILE, line: 20, column: 3 });
    clientSourceMapCache.set(`${CALLSITE_URL}:65:84`, null); // WARM, definitively unmappable
    const callSite = makeFiberWithFrame(CALLSITE_URL, 65, 84);
    const leaf = makeFiberWithFrame(LEAF_URL, 100, 15, callSite);

    const { ctx } = makeCtxWithSpies();
    const resolver = createIframeResolver(ctx);
    const result = resolver.resolveClickLocal(attach({}, leaf));

    expect(result).toBeNull();
    expect(ctx.pendingClickElement.current).toBeNull(); // terminal — no pending click registered
  });

  test('resolveClickLocal commits the TRUE call site (Feed.tsx) once the call-site frame is WARM', () => {
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: LEAF_FILE, line: 20, column: 3 });
    // <Tweet> call site now resolves to its ORIGINAL Feed.tsx position (line 46, not compiled 65).
    clientSourceMapCache.set(`${CALLSITE_URL}:65:84`, { fileName: 'src/components/Feed.tsx', line: 46, column: 10 });
    const callSite = makeFiberWithFrame(CALLSITE_URL, 65, 84);
    const leaf = makeFiberWithFrame(LEAF_URL, 100, 15, callSite);

    const { ctx } = makeCtxWithSpies();
    const resolver = createIframeResolver(ctx);
    const result = resolver.resolveClickLocal(attach({}, leaf));

    expect(result?.nodeRef).toBe('src/components/Feed.tsx:46:10');
    expect(ctx.pendingClickElement.current).toBeNull();
  });

  test('an ancestor with NO unresolved frame (definitive/frameless) is SKIPPED, not treated as cold — walk reaches the warm call site (Codex P1 #3)', () => {
    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: LEAF_FILE, line: 20, column: 3 });
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

describe('resolveClickLocal LEAF seed: never commit a raw React-19 compiled _debugStack position (HYP-970 residual)', () => {
  // react-vite-tw4-twitter: clicking a host <div> written DIRECTLY in the rendered App.tsx.
  // Under React 19 + Vite the leaf's OWN _debugStack first frame is the COMPILED position in the
  // jsxDEV-transformed App.tsx module (e.g. src/App.tsx:101:32 — past the 58-line source's EOF),
  // NOT the original source. getSourceLocationFromDOM (parseDebugStack) hands this compiled frame
  // to resolveClickLocal as the seed. Because the leaf's own file is editable, resolveCallSiteTarget's
  // own-source short-circuit (isEditableSourcePath) returns it verbatim — so the cross-file mapper
  // HYP-970 added to the ancestor walk never sees it. When the
  // client source map is COLD, the compiled seed must NOT be committed: AstService can't resolve
  // line 101 and EVERY inspector style write fails ("Element not found"/"Style update failed").
  // DevTools-faithful rule: a raw _debugStack frame is only an INPUT to symbolication; if unmapped,
  // warm + defer (retryPendingClick re-resolves once the map lands), never emit the compiled line.
  const APP_URL = 'http://localhost:5173/src/App.tsx';

  function attach(el: object, fiber: Fiber): HTMLElement {
    (el as Record<'__reactFiber$test', Fiber>).__reactFiber$test = fiber;
    return el as HTMLElement;
  }
  function makeCtx() {
    const warmedFiber: Fiber[] = [];
    const ctx = {
      renderedComponentPath: 'src/App.tsx',
      pendingClickElement: { current: null as HTMLElement | null },
      pendingClickTimestamp: { value: 0 },
      warmServerChunkFrames: (_f: Fiber) => {},
      warmFiberChunkFrames: (f: Fiber) => warmedFiber.push(f),
    };
    return { ctx, warmedFiber };
  }

  test('COLD compiled leaf frame in the rendered file → DEFERS (never commits the compiled src/App.tsx:101 line)', () => {
    // Leaf's own frame src/App.tsx:101:32 is COMPILED and NOT cached (cold).
    const leaf = makeFiberWithFrame(APP_URL, 101, 32);
    const { ctx, warmedFiber } = makeCtx();
    const resolver = createIframeResolver(ctx);

    const result = resolver.resolveClickLocal(attach({}, leaf));

    // Must NOT commit the compiled position (line 101 does not exist in the 58-line source).
    expect(result).toBeNull();
    // Deferred to the warm-retry: pending click registered + the leaf's own frame warmed so the
    // NEXT pass (retryPendingClick) resolves the mapped original position.
    expect(ctx.pendingClickElement.current).not.toBeNull();
    expect(warmedFiber).toContain(leaf);
  });

  test('WARM compiled leaf frame → commits the source-map-MAPPED original position (src/App.tsx:46:8)', () => {
    // The same compiled frame, now warmed: the map resolves src/App.tsx:101:32 → the real App.tsx:46:8.
    clientSourceMapCache.set(`${APP_URL}:101:32`, { fileName: 'src/App.tsx', line: 46, column: 8 });
    const leaf = makeFiberWithFrame(APP_URL, 101, 32);
    const { ctx } = makeCtx();
    const resolver = createIframeResolver(ctx);

    const result = resolver.resolveClickLocal(attach({}, leaf));

    expect(result?.nodeRef).toBe('src/App.tsx:46:8');
    expect(ctx.pendingClickElement.current).toBeNull();
  });

  test('React-18 _debugSource leaf in the rendered file is STILL trusted without a source map (no over-defer)', () => {
    // React 18 projects: getSourceLocationFromDOM returns a REAL original position from
    // _debugSource — the seed must be committed directly, never deferred. Guards the fix from
    // regressing the _debugSource path (conloca-style resolution stays intact).
    const leaf = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: { fileName: 'src/App.tsx', lineNumber: 12, columnNumber: 7 },
      _debugStack: null,
      _debugOwner: null,
    } as unknown as Fiber;
    const { ctx } = makeCtx();
    const resolver = createIframeResolver(ctx);

    const result = resolver.resolveClickLocal(attach({}, leaf));

    // _debugSource.columnNumber is 1-based → SourceLocation.column 0-based (7 → 6).
    expect(result?.nodeRef).toBe('src/App.tsx:12:6');
    expect(ctx.pendingClickElement.current).toBeNull();
  });
});

describe('getSourceLocation FALLBACK: never return a raw compiled React-19 seed (HYP-974 companion)', () => {
  // click-handler.ts falls back to resolver.getSourceLocation(target) when resolveClickLocal
  // returns null (a deliberate defer). If getSourceLocation re-derives the SAME compiled
  // `_debugStack` seed and returns it, the extension commits it (onElementClick →
  // computeEffectiveRef(null, source) = src/App.tsx:101:32) and the defer is defeated — the past-EOF
  // nodeRef still fails every style write. getSourceLocation must suppress the compiled cold seed
  // too, so the fallback yields null and the click defers to the warm-retry.
  const APP_URL = 'http://localhost:5173/src/App.tsx';

  function attach(el: object, fiber: Fiber): HTMLElement {
    (el as Record<'__reactFiber$test', Fiber>).__reactFiber$test = fiber;
    return el as HTMLElement;
  }
  function makeCtx() {
    return {
      renderedComponentPath: 'src/App.tsx',
      pendingClickElement: { current: null as HTMLElement | null },
      pendingClickTimestamp: { value: 0 },
      warmServerChunkFrames: (_f: Fiber) => {},
      warmFiberChunkFrames: (_f: Fiber) => {},
    };
  }

  test('COLD compiled leaf frame → getSourceLocation returns null (suppresses the compiled seed)', () => {
    const leaf = makeFiberWithFrame(APP_URL, 101, 32); // cold, not cached
    const resolver = createIframeResolver(makeCtx());
    expect(resolver.getSourceLocation(attach({}, leaf))).toBeNull();
  });

  test('WARM compiled leaf frame → getSourceLocation returns the mapped original position', () => {
    clientSourceMapCache.set(`${APP_URL}:101:32`, { fileName: 'src/App.tsx', line: 46, column: 8 });
    const leaf = makeFiberWithFrame(APP_URL, 101, 32);
    const resolver = createIframeResolver(makeCtx());
    expect(resolver.getSourceLocation(attach({}, leaf))).toEqual({ fileName: 'src/App.tsx', line: 46, column: 8 });
  });

  test('React-18 _debugSource leaf → getSourceLocation returns the real position (no suppression)', () => {
    const leaf = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: { fileName: 'src/App.tsx', lineNumber: 12, columnNumber: 7 },
      _debugStack: null,
      _debugOwner: null,
    } as unknown as Fiber;
    const resolver = createIframeResolver(makeCtx());
    expect(resolver.getSourceLocation(attach({}, leaf))).toEqual({ fileName: 'src/App.tsx', line: 12, column: 6 });
  });
});

describe('pending-click warm-retry wiring: resolver write must reach the host retry reader (HYP-971)', () => {
  // The auto-recovery was architecturally DEAD: the resolver wrote `ctx.pendingClickElement`
  // (a by-VALUE copy of a bare `HTMLElement | null` primitive passed into ctx), while
  // `retryPendingClick` in iframe-interaction.ts read a SEPARATE module var that was only ever
  // assigned null. So a cold-map click no-op'd and never auto-recovered (only a manual second
  // click resolved), yet PR comments/tests claimed "defers to the warm-retry (verified working)".
  // Boxing the ref (`{ current }`, like pendingClickTimestamp) and passing the SAME object makes
  // the resolver's write visible to the retry — this suite proves BOTH halves of that wiring.
  const APP_URL = 'http://localhost:5173/src/App.tsx';

  function attach(el: object, fiber: Fiber): HTMLElement {
    (el as Record<'__reactFiber$test', Fiber>).__reactFiber$test = fiber;
    return el as HTMLElement;
  }

  test('resolveClickLocal writes the deferred element onto the SHARED boxed ref that retryPendingClick reads', () => {
    // Reproduces the production wiring: a single boxed pending-click object is the ctx field.
    // A cold compiled React-19 leaf defers (HYP-974) and registers the pending click. The value
    // the host retry guard reads (`pendingClickElementRef.current`) IS this shared box's `.current`.
    const pendingClickElement = { current: null as HTMLElement | null };
    const ctx = {
      renderedComponentPath: 'src/App.tsx',
      pendingClickElement,
      pendingClickTimestamp: { value: 0 },
      warmServerChunkFrames: (_f: Fiber) => {},
      warmFiberChunkFrames: (_f: Fiber) => {},
    };
    const leaf = makeFiberWithFrame(APP_URL, 101, 32); // cold (uncached) compiled leaf
    const el = attach({}, leaf);

    const result = createIframeResolver(ctx).resolveClickLocal(el);

    // Deferred (no bogus compiled commit) AND the shared box now holds the clicked element —
    // so `retryPendingClick`'s `if (!pendingClickElementRef.current)` guard passes (was dead:
    // a by-value copy left the module var null, so the guard always early-returned).
    expect(result).toBeNull();
    expect(pendingClickElement.current).toBe(el);
    expect(ctx.pendingClickTimestamp.value).toBeGreaterThan(0);
  });

  test('iframe-interaction.ts wires the SAME boxed ref to the resolver AND reads it in retryPendingClick (no dead by-value copy)', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'iframe-interaction.ts'), 'utf8');
    // No bare mutable primitive — that was the by-value copy whose write never reached the retry.
    expect(src).not.toMatch(/let\s+pendingClickElement\b/);
    // The pending click is a BOXED ref…
    expect(src).toMatch(/const\s+pendingClickElementRef\s*:\s*\{\s*current:/);
    // …passed BY REFERENCE (same object) into the resolver ctx…
    expect(src).toMatch(/pendingClickElement:\s*pendingClickElementRef/);
    // …and the host retry + empty-click guard read that same box.
    expect(src).toMatch(/pendingClickElementRef\.current/);
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
