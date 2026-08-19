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
import { resolveCallSiteTarget } from '@shared/canvas-interaction/resolve-source';
import type { Fiber } from '@shared/element-tracing/fiber-internals';
import {
  clientSourceMapCache,
  resolveOwnClientSourceMap,
  resolveViaClientSourceMap,
  resolveViaServerSourceMap,
  serverSourceMapCache,
} from '../iframe-source-maps';
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

  /**
   * Fresh-quorum finding (HYP-1220 follow-up, k3): resolveViaClientSourceMap now legitimately
   * RETURNS a synthetic __canvas_preview__.tsx location (pre-fix it always climbed past it).
   * When resolveCallSiteSource's own recoverNonSyntheticSourceLocation fails to find the real
   * rendered component (e.g. renderedComponentPath is null, exercised here), it keeps the
   * synthetic location as a retry sentinel. click-handler.ts's FALLBACK path (used when
   * resolveClickLocal returns null) and every drag-path consumer call getSourceLocation
   * directly with no synthetic guard of their own — without suppression here, that sentinel
   * would be committed as a real click/drag target: src/__canvas_preview__.tsx is a real
   * on-disk generated file, so AstService resolves it and an inspector write there is
   * silently clobbered on the next preview regen.
   */
  test('a synthetic-preview hit that recovery cannot resolve → getSourceLocation returns null (suppresses the sentinel)', () => {
    const SYNTHETIC_URL = 'http://localhost:5173/src/__canvas_preview__.tsx';
    clientSourceMapCache.set(`${SYNTHETIC_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    const leaf = makeFiberWithFrame(SYNTHETIC_URL, 969, 31);
    // renderedComponentPath: null → recoverNonSyntheticSourceLocation trivially fails
    // (fiber-internals.ts: `if (!renderedFile) return null;`), so the synthetic location
    // would otherwise survive as the sentinel this test proves gets suppressed.
    const resolver = createIframeResolver({ ...makeCtx(), renderedComponentPath: null });

    expect(resolver.getSourceLocation(attach({}, leaf))).toBeNull();
  });

  test('a synthetic-preview hit that DOES recover → getSourceLocation returns the real recovered location (no over-suppression)', () => {
    const SYNTHETIC_URL = 'http://localhost:5173/src/__canvas_preview__.tsx';
    const CHAT_INPUT_BAR_PATH = 'src/components/ChatInputBar.tsx';
    clientSourceMapCache.set(`${SYNTHETIC_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    // A descendant fiber whose own source IS the rendered component — recovery finds it via
    // the descendant scan (recoverNonSyntheticSourceLocation's resolution order, step 2).
    const rendered = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: { fileName: 'src/components/ChatInputBar.tsx', lineNumber: 9, columnNumber: 6 },
      _debugStack: null,
      _debugOwner: null,
    } as unknown as Fiber;
    const leaf = makeFiberWithFrame(SYNTHETIC_URL, 969, 31);
    leaf.child = rendered;
    const resolver = createIframeResolver({ ...makeCtx(), renderedComponentPath: CHAT_INPUT_BAR_PATH });

    const result = resolver.getSourceLocation(attach({}, leaf));

    expect(result?.fileName).not.toBe('src/__canvas_preview__.tsx');
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

  test('iframe-interaction.ts passes mapOwnFiberSource to resolveCallSiteSource', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'iframe-interaction.ts'), 'utf8');
    // Dropping the trailing mapper arg leaves `resolveCallSiteSource(loc, fiber,
    // renderedComponentPath)` — no mapOwnFiberSource inside the arg list → this fails.
    expect(src).toMatch(/resolveCallSiteSource\s*\([^)]*mapOwnFiberSource\s*\)/);
  });

  // resolveCallSiteTarget's OWN call site lives in iframe-pending-click-retry.ts (extracted
  // out of iframe-interaction.ts's retryPendingClick so the TTL-fallback logic added for the
  // Codex P2 finding on PR #717 is unit-testable — see that file's header comment). Checked
  // separately because its argument list contains a `ctx.renderedComponentPath()` CALL, whose
  // own parens break the `[^)]*` "no close-paren in between" trick the sibling assertion above
  // relies on.
  test('iframe-pending-click-retry.ts (retryPendingClick warm-retry path) passes mapOwnFiberSource to resolveCallSiteTarget', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'iframe-pending-click-retry.ts'), 'utf8');
    // Anchored to the `resolveNonTerminal` function body (not "first resolveCallSiteTarget(
    // anywhere in the file") so a later comment or second call site elsewhere can't make this
    // pass for the wrong reason.
    const fnMatch = src.match(/function resolveNonTerminal\([\s\S]*?\n {2}\}/);
    expect(fnMatch).not.toBeNull();
    const callMatch = fnMatch?.[0].match(/resolveCallSiteTarget\(([\s\S]*?)\);/);
    expect(callMatch).not.toBeNull();
    expect(callMatch?.[1]).toContain('mapOwnFiberSource');
  });

  // Fable's review finding (HYP-1220 PR #717, round 3): "No test asserts that production
  // wiring in iframe-interaction.ts actually passes armPendingClickFallback — deleting that
  // one production line would pass the entire suite while silently reintroducing the [stuck-
  // pending-ref] bug." armPendingClickFallback is OPTIONAL on ResolverContext (so the many
  // existing test fixtures above don't all need updating), so nothing else in this suite would
  // catch that regression — this is the one guard for it.
  test('iframe-interaction.ts wires armPendingClickFallback into createIframeResolver', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'iframe-interaction.ts'), 'utf8');
    const callMatch = src.match(/createIframeResolver\(\{([\s\S]*?)\}\);/);
    expect(callMatch).not.toBeNull();
    expect(callMatch?.[1]).toContain('armPendingClickFallback');
  });
});

/**
 * HYP-1220: tamagui-whatsapp regression of HYP-424/HYP-429 (click resolves to the
 * entry-point file, not the real component source).
 *
 * Root cause: `mapOwnFiberSource`/`mapOrWarmCallSite` are reused as the CALL-SITE
 * mapper passed into `resolveCallSiteTarget`'s ancestor walk, but they were built on
 * `resolveOwnServerSourceMap`/`resolveOwnClientSourceMap` — which HIDE a synthetic-
 * preview hit as "still cold" (correct for LEAF resolution, HYP-429). Reused as the
 * call-site mapper, that hid the walk's own `isSyntheticPreviewPath` boundary check:
 * an ancestor whose call site collapsed to `__canvas_preview__.tsx` looked like "no
 * location yet" instead of "resolved to the wrapper", so the walk climbed PAST the
 * wrapper to whatever rendered it — the project's `main.tsx` entry, which passes
 * `isEditableSourcePath` and got committed as the clicked element's source.
 *
 * This models the real Docker-reproduced tamagui-whatsapp shape: a `div[style]`
 * inside ChatInputBar's Tamagui-styled tree, several node_modules-internal ancestor
 * layers up, with the ChatInputBar component fiber's OWN call site collapsed to the
 * synthetic preview wrapper (the "JSX line optimized out of _debugStack" case
 * documented in fiber-internals.ts) and, one level further up, the wrapper's own
 * mount call site resolving to `src/main.tsx` — a REAL, editable, non-synthetic file
 * that must never be mistaken for ChatInputBar's call site.
 */
describe('call-site mapper does not leak past the synthetic-preview boundary to main.tsx (HYP-1220)', () => {
  const TAMAGUI_INTERNAL_URL = 'http://localhost:5173/node_modules/.vite/deps/tamagui.js';
  const CANVAS_PREVIEW_CALL_SITE_URL = 'http://localhost:5173/src/__canvas_preview__.tsx';
  const MAIN_URL = 'http://localhost:5173/src/main.tsx';
  const CHAT_INPUT_BAR_CALL_SITE_URL = 'http://localhost:5173/src/components/ChatInputBar.tsx';

  test('mapOwnFiberSource surfaces a synthetic-preview call site instead of hiding it as cold', () => {
    // The ChatInputBar component fiber's own call site (where <ChatInputBar/> is
    // written) is INSIDE the synthetic wrapper — a real, resolved mapping, not a
    // cold cache miss.
    clientSourceMapCache.set(`${CANVAS_PREVIEW_CALL_SITE_URL}:12:6`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 12,
      column: 6,
    });
    const chatInputBarComponent = makeFiberWithFrame(CANVAS_PREVIEW_CALL_SITE_URL, 12, 6);

    const mapped = mapOwnFiberSource(chatInputBarComponent);

    // Before the fix this returned `null` (indistinguishable from "still warming"),
    // which let resolveCallSiteTarget's walk skip past this ancestor entirely.
    expect(mapped).not.toBeNull();
    expect(mapped?.fileName).toBe('src/__canvas_preview__.tsx');
  });

  test('resolveCallSiteTarget stops at the synthetic-wrapper boundary — never commits main.tsx (the wrapper renderer)', () => {
    // Leaf: the clicked div[style], its own source map hit is a node_modules
    // Tamagui internal (non-editable, non-synthetic) — a real resolved position.
    const leafOwnSource = { fileName: 'node_modules/@tamagui/core/dist/esm/View.mjs', line: 120, column: 5 };
    clientSourceMapCache.set(`${TAMAGUI_INTERNAL_URL}:50:10`, leafOwnSource);
    // Intermediate Tamagui wrapper layer — also a node_modules internal call site.
    clientSourceMapCache.set(`${TAMAGUI_INTERNAL_URL}:80:20`, {
      fileName: 'node_modules/@tamagui/core/dist/esm/createComponent.mjs',
      line: 44,
      column: 2,
    });
    // The ChatInputBar component fiber's OWN call site collapses to the synthetic
    // preview wrapper (the "JSX line optimized out" case).
    clientSourceMapCache.set(`${CANVAS_PREVIEW_CALL_SITE_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    // One level further up: the wrapper's OWN mount call site — a REAL, editable,
    // non-synthetic project file (main.tsx). Must never be committed for this click.
    clientSourceMapCache.set(`${MAIN_URL}:8:1`, { fileName: 'src/main.tsx', line: 8, column: 1 });

    const canvasPreviewMount = makeFiberWithFrame(MAIN_URL, 8, 1);
    const chatInputBarComponent = makeFiberWithFrame(CANVAS_PREVIEW_CALL_SITE_URL, 969, 31, canvasPreviewMount);
    const tamaguiWrapper = makeFiberWithFrame(TAMAGUI_INTERNAL_URL, 80, 20, chatInputBarComponent);
    const clickedDiv = makeFiberWithFrame(TAMAGUI_INTERNAL_URL, 50, 10, tamaguiWrapper);

    const result = resolveCallSiteTarget(
      leafOwnSource,
      clickedDiv,
      'src/components/ChatInputBar.tsx',
      0,
      mapOwnFiberSource,
    );

    // The regression: this used to equal `{ fileName: 'src/main.tsx', line: 8, column: 1 }`.
    expect(result.source.fileName).not.toBe('src/main.tsx');
    expect(result.source.fileName).not.toContain('__canvas_preview__');
    // Safe fallback: no editable call site was found between the leaf and the
    // synthetic boundary, so the walk keeps the element's own (node_modules) leaf
    // source — never a wrong FILE. The extension's click path (resolveClickLocal /
    // retryPendingClick) additionally defers a non-editable result like this one
    // instead of committing it (see the isEditableSourcePath guard tests above and
    // in iframe-interaction.ts's retryPendingClick).
    expect(result.source).toEqual(leafOwnSource);
  });

  test('resolveClickLocal defers on a COLD non-editable call-site ancestor AND arms the TTL fallback (Codex P2, HYP-1220 PR #717)', () => {
    // The clicked element's own source resolves (via a cached client source map) to a
    // node_modules internal — non-editable — and its call-site ancestor's frame is NOT yet
    // cached (genuinely cold), so `resolveClickLocal` takes the `coldCallSite` branch of the
    // non-editable guard and calls `deferToWarmRetry`. This is the ONE defer site inside
    // `resolveClickLocal` that is actually reachable in production (the sibling
    // "still-synthetic" guard a few lines below it is unreachable: `isEditableSourcePath`
    // already excludes any synthetic path, so by the time that check would run,
    // `isSyntheticPreviewPath(source.fileName)` can never be true — verified by direct code
    // reading, not by this test). Asserts the defer now arms the TTL fallback here too, not
    // just in the warm-retry (iframe-pending-click-retry.ts) path Codex originally flagged.
    const LEAF_URL = 'http://localhost:5173/src/deps/acme-ui-button.js';
    const LEAF_FILE = 'node_modules/@acme/ui/dist/button.js';
    const CALLSITE_URL = 'http://localhost:5173/src/components/Feed.tsx';

    clientSourceMapCache.set(`${LEAF_URL}:100:15`, { fileName: LEAF_FILE, line: 20, column: 3 });
    const callSite = makeFiberWithFrame(CALLSITE_URL, 65, 84); // NOT cached — genuinely cold
    const leaf = makeFiberWithFrame(LEAF_URL, 100, 15, callSite);
    const el = {} as unknown as HTMLElement;
    (el as unknown as Record<'__reactFiber$test', Fiber>).__reactFiber$test = leaf;

    let armCallCount = 0;
    const ctx = {
      renderedComponentPath: 'src/App.tsx',
      pendingClickElement: { current: null as HTMLElement | null },
      pendingClickTimestamp: { value: 0 },
      warmServerChunkFrames: (_f: Fiber) => {},
      warmFiberChunkFrames: (_f: Fiber) => {},
      armPendingClickFallback: () => {
        armCallCount++;
      },
    };

    const result = createIframeResolver(ctx).resolveClickLocal(el);

    expect(result).toBeNull(); // deferred, never committed as a bad (node_modules) selection
    expect(ctx.pendingClickElement.current).toBe(el);
    expect(armCallCount).toBeGreaterThan(0);
  });

  test('resolveClickLocal resolves a real click on a Tamagui-nested div to ChatInputBar.tsx (not the entry point)', () => {
    // The success path: an intermediate Tamagui wrapper's OWN call site IS the true,
    // editable ChatInputBar.tsx location (where <XStack .../> is written) — the walk
    // must find and commit THIS, exactly matching HYP-1220's acceptance criteria.
    const leafOwnSource = { fileName: 'node_modules/@tamagui/core/dist/esm/View.mjs', line: 120, column: 5 };
    clientSourceMapCache.set(`${TAMAGUI_INTERNAL_URL}:50:10`, leafOwnSource);
    clientSourceMapCache.set(`${CHAT_INPUT_BAR_CALL_SITE_URL}:8:5`, {
      fileName: 'src/components/ChatInputBar.tsx',
      line: 8,
      column: 5,
    });

    const xstackCallSite = makeFiberWithFrame(CHAT_INPUT_BAR_CALL_SITE_URL, 8, 5);
    const clickedDiv = makeFiberWithFrame(TAMAGUI_INTERNAL_URL, 50, 10, xstackCallSite);

    const ctx = {
      renderedComponentPath: 'src/components/ChatInputBar.tsx',
      pendingClickElement: { current: null as HTMLElement | null },
      pendingClickTimestamp: { value: 0 },
      warmServerChunkFrames: (_f: Fiber) => {},
      warmFiberChunkFrames: (_f: Fiber) => {},
    };
    const el = {} as unknown as HTMLElement;
    (el as unknown as Record<'__reactFiber$test', Fiber>).__reactFiber$test = clickedDiv;

    const result = createIframeResolver(ctx).resolveClickLocal(el);

    expect(result?.nodeRef).toBe('src/components/ChatInputBar.tsx:8:5');
    expect(result?.nodeRef).not.toContain('__canvas_preview__');
    expect(result?.nodeRef).not.toContain('main.tsx');
  });

  // retryPendingClick historically had NO isEditableSourcePath/isSyntheticPreviewPath check —
  // resolveClickLocal defers a non-editable/synthetic result instead of committing it, but the
  // warm-retry callback (triggered once source maps finish warming) posted whatever
  // resolveCallSiteTarget returned straight to the parent webview. That check now lives in
  // `resolveNonTerminal` inside iframe-pending-click-retry.ts (extracted from retryPendingClick
  // so the Codex P2 TTL-fallback fix on PR #717 is unit-testable) — a former source-text regex
  // parity guard for it was removed in favor of the behavioral test with the same name in that
  // file's own test suite ("clears a stuck pending click within the TTL window..."), which
  // drives the real guard with a non-editable source and asserts it defers (never calls
  // `onResolved`) rather than pattern-matching the function body's text.
});

/**
 * HYP-1220 (second occurrence): the first fix above only guarded the CALL-SITE mapper
 * used by `resolveCallSiteTarget`'s ancestor walk (`mapOwnFiberSource`). It shipped with
 * 2082/2082 unit tests green, but a live Electron/VS Code e2e run against the real
 * tamagui-whatsapp fixture still reproduced the bug deterministically:
 * `clicking div[style] must resolve to ChatInputBar.tsx, got src/main.tsx:11:58`.
 *
 * Root cause: `resolveViaClientSourceMap`/`resolveViaServerSourceMap` (the LEAF
 * ancestor-walking resolvers used by `resolveClickLocal` to compute the INITIAL
 * `directSource`, BEFORE `resolveCallSiteTarget`'s own call-site walk ever runs) have
 * the identical hiding bug: `resolveOwnClientSourceMap` reports a fiber whose own frame
 * resolves to the synthetic wrapper as `{ resolved: undefined }` — indistinguishable
 * from "still cold" — so the walk kept climbing past the wrapper to whatever fiber
 * renders it (the project's `main.tsx` mount call site: a real, editable, non-synthetic
 * file). That `main.tsx` location then became `resolveClickLocal`'s `directSource`
 * directly — NOT flagged synthetic — so `resolveCallSiteTarget`'s own
 * `isSyntheticPreviewPath`/recovery logic never even ran; `main.tsx` looked like a
 * perfectly valid, editable, resolved click target and got committed immediately.
 *
 * This reproduces the REAL fiber shape from the live e2e failure: the clicked
 * `<div style>`'s OWN `_debugStack` collapses directly to the synthetic wrapper (no
 * intervening node_modules frame at all — unlike the first HYP-1220 test above, which
 * modeled the leaf's own source as a resolved node_modules hit), and one level up the
 * wrapper's own mount call site resolves to `src/main.tsx`.
 */
describe('resolveViaClientSourceMap does not leak past the synthetic-preview boundary to main.tsx (HYP-1220, live e2e regression)', () => {
  const CANVAS_PREVIEW_SCAFFOLD_URL = 'http://localhost:5173/src/__canvas_preview__.tsx';
  const MAIN_URL = 'http://localhost:5173/src/main.tsx';
  const CHAT_INPUT_BAR_URL = 'http://localhost:5173/src/components/ChatInputBar.tsx';

  test('resolveViaClientSourceMap stops at the synthetic boundary instead of climbing to main.tsx', () => {
    // The clicked div's OWN frame resolves directly to the synthetic wrapper — no
    // intervening node_modules frame, matching the live tamagui-whatsapp trace exactly.
    clientSourceMapCache.set(`${CANVAS_PREVIEW_SCAFFOLD_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    // One level up: the wrapper's OWN mount call site — a REAL, editable file. Before
    // the fix, this is exactly what got returned as the "leaf's own resolved source".
    clientSourceMapCache.set(`${MAIN_URL}:11:58`, { fileName: 'src/main.tsx', line: 11, column: 58 });

    const mainMount = makeFiberWithFrame(MAIN_URL, 11, 58);
    const clickedDiv = makeFiberWithFrame(CANVAS_PREVIEW_SCAFFOLD_URL, 969, 31, mainMount);

    const result = resolveViaClientSourceMap(clickedDiv);

    // The regression: this used to equal `{ fileName: 'src/main.tsx', line: 11, column: 58 }`.
    expect(result?.fileName).not.toBe('src/main.tsx');
    // Correct: stops at the wrapper boundary and surfaces the synthetic location itself,
    // so resolveCallSiteTarget's recovery logic (recoverNonSyntheticSourceLocation) gets
    // a chance to run instead of the walk silently landing on an unrelated ancestor.
    expect(result?.fileName).toBe('src/__canvas_preview__.tsx');
  });

  test('end-to-end resolveClickLocal: a div whose own source collapses to the wrapper recovers ChatInputBar.tsx via the fiber tree, never main.tsx', () => {
    // Same boundary shape as above, but now the rendered ChatInputBar component is
    // reachable as a SIBLING/descendant fiber so recoverNonSyntheticSourceLocation can
    // recover it — exercising the full resolveClickLocal path end-to-end.
    clientSourceMapCache.set(`${CANVAS_PREVIEW_SCAFFOLD_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    clientSourceMapCache.set(`${MAIN_URL}:11:58`, { fileName: 'src/main.tsx', line: 11, column: 58 });

    const mainMount = makeFiberWithFrame(MAIN_URL, 11, 58);
    const clickedDiv = makeFiberWithFrame(CANVAS_PREVIEW_SCAFFOLD_URL, 969, 31, mainMount);
    // The rendered ChatInputBar component is a CHILD of the clicked div in this
    // synthetic fixture (findDescendantSource's scan direction) — its raw _debugStack
    // names the real component file directly (React 19 dev mode keeps the file name
    // even when line/col is a compiled position).
    const chatInputBarDescendant = makeFiberWithFrame(CHAT_INPUT_BAR_URL, 25, 8);
    clickedDiv.child = chatInputBarDescendant;

    const ctx = {
      renderedComponentPath: 'src/components/ChatInputBar.tsx',
      pendingClickElement: { current: null as HTMLElement | null },
      pendingClickTimestamp: { value: 0 },
      warmServerChunkFrames: (_f: Fiber) => {},
      warmFiberChunkFrames: (_f: Fiber) => {},
    };
    const el = {} as unknown as HTMLElement;
    (el as unknown as Record<'__reactFiber$test', Fiber>).__reactFiber$test = clickedDiv;

    const result = createIframeResolver(ctx).resolveClickLocal(el);

    expect(result?.nodeRef).not.toContain('main.tsx');
    expect(result?.nodeRef).not.toContain('__canvas_preview__');
    expect(result?.nodeRef).toContain('ChatInputBar.tsx');
  });

  /**
   * Fresh-quorum finding (HYP-1220 follow-up, Opus round 2), verified end-to-end: same
   * fixture as the test above (clicked div's own frame collapses to the synthetic wrapper,
   * ChatInputBar is reachable as a descendant, recovery would normally find it) — EXCEPT
   * the clicked div's `_debugStack` also carries a cold SIBLING frame ahead of the
   * already-cached synthetic frame (a plausible mid-warm-up race). Because
   * `classifyOwnClientCallSite`'s post-loop order checks `sawCold` BEFORE the synthetic
   * check, this fiber classifies as `'cold'` (not `'synthetic'`), so `resolveViaClientSourceMap`
   * climbs PAST the wrapper straight to the ancestor's REAL hit (`main.tsx`) instead of
   * returning the synthetic boundary. Critically, `directSource` is then a REAL (non-synthetic)
   * hit on the WRONG file — `recoverNonSyntheticSourceLocation` never even runs (it is gated
   * on `isSyntheticPreviewPath(directSource.fileName)`, which is now false) — so the recovery
   * layer that saves the test above cannot save this one. This DOES reproduce the exact
   * HYP-1220 symptom end-to-end during this race window; see the ticket filed alongside this
   * commit for the fix.
   */
  test('KNOWN GAP (tracked, see linked follow-up ticket): a cold sibling frame ahead of a settled synthetic hit still lets resolveClickLocal commit main.tsx', () => {
    const COLD_SIBLING_URL = 'http://localhost:5173/src/components/StillWarming3.tsx';
    const stack = new Error();
    stack.stack = [
      'Error',
      `    at ${COLD_SIBLING_URL}:1:1`, // cold — never cached below
      `    at ${CANVAS_PREVIEW_SCAFFOLD_URL}:969:31`, // cached synthetic
    ].join('\n');
    const clickedDiv = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugStack: stack,
      _debugOwner: null,
    } as unknown as Fiber;
    clientSourceMapCache.set(`${CANVAS_PREVIEW_SCAFFOLD_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    clientSourceMapCache.set(`${MAIN_URL}:11:58`, { fileName: 'src/main.tsx', line: 11, column: 58 });
    clickedDiv.return = makeFiberWithFrame(MAIN_URL, 11, 58);
    // ChatInputBar reachable as a descendant, exactly like the passing test above — recovery
    // WOULD find it, but never gets the chance to run in this race window.
    clickedDiv.child = makeFiberWithFrame(CHAT_INPUT_BAR_URL, 25, 8);

    const ctx = {
      renderedComponentPath: 'src/components/ChatInputBar.tsx',
      pendingClickElement: { current: null as HTMLElement | null },
      pendingClickTimestamp: { value: 0 },
      warmServerChunkFrames: (_f: Fiber) => {},
      warmFiberChunkFrames: (_f: Fiber) => {},
    };
    const el = {} as unknown as HTMLElement;
    (el as unknown as Record<'__reactFiber$test', Fiber>).__reactFiber$test = clickedDiv;

    const result = createIframeResolver(ctx).resolveClickLocal(el);

    expect(result?.nodeRef).toBe('src/main.tsx:11:58');
  });
});

/**
 * Guardrails for the HYP-1220 boundary fix itself (review-cli findings on this PR):
 *   1. The server-side mirror (`resolveViaServerSourceMap`) must have its OWN test —
 *      it shipped as an untested "same shape" claim in the doc comment alone.
 *   2. A fiber that is genuinely COLD (no cached frame at all, or a still-warming
 *      frame ahead of an already-cached synthetic one) must still climb `.return` to
 *      find a real ancestor — the exact invariant the new synthetic-boundary scan
 *      could silently break if it stops too early.
 */
describe('HYP-1220 boundary-fix guardrails: cold fibers still walk, server path is covered too', () => {
  const CHAT_INPUT_BAR_URL = 'http://localhost:5173/src/components/ChatInputBar.tsx';
  const SERVER_WRAPPER_FILE = '/repo/.next/server/chunks/__canvas_preview__.js';
  const SERVER_MAIN_FILE = '/repo/.next/server/chunks/main.js';
  const SERVER_CHAT_INPUT_BAR_FILE = '/repo/.next/server/chunks/ChatInputBar.js';

  function makeFiberWithServerFrame(filePath: string, line: number, col: number, ret: Fiber | null = null): Fiber {
    const stack = new Error();
    stack.stack = `Error\n    at file://${filePath}:${line}:${col}`;
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

  beforeEach(() => {
    serverSourceMapCache.clear();
  });
  afterEach(() => {
    serverSourceMapCache.clear();
  });

  test('resolveViaServerSourceMap (RSC/Next.js path) stops at the synthetic boundary and does not climb to a real ancestor — server-side mirror of the client fix', () => {
    // isSyntheticPreviewPath matches on basename only ('__canvas_preview__.tsx' /
    // '__canvas_preview_standalone__.tsx'), so the cached SourceLocation's fileName must
    // use one of those exact basenames to exercise the real boundary-stop path — the
    // compiled `.next/server/chunks/...` path is just where the FRAME lives, not what
    // gets cached (source-map resolution always yields the ORIGINAL source path).
    serverSourceMapCache.set(`${SERVER_WRAPPER_FILE}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    serverSourceMapCache.set(`${SERVER_MAIN_FILE}:11:58`, { fileName: 'src/main.tsx', line: 11, column: 58 });

    const mainMount = makeFiberWithServerFrame(SERVER_MAIN_FILE, 11, 58);
    const clickedDiv = makeFiberWithServerFrame(SERVER_WRAPPER_FILE, 969, 31, mainMount);

    const result = resolveViaServerSourceMap(clickedDiv);

    // The regression: this used to equal `{ fileName: 'src/main.tsx', line: 11, column: 58 }`.
    expect(result?.fileName).not.toBe('src/main.tsx');
    expect(result?.fileName).toBe('src/__canvas_preview__.tsx');
  });

  test('resolveViaServerSourceMap: a synthetic hit does NOT stop the walk while an earlier frame on the SAME fiber is still cold', () => {
    // The wrapper frame is already cached as synthetic, but this fiber ALSO carries an
    // uncached (cold) frame — the walk must not treat this fiber as a settled boundary
    // yet; it must climb to the real ancestor (ChatInputBar) instead of stopping here.
    const stack = new Error();
    stack.stack = [
      'Error',
      `    at file://${SERVER_MAIN_FILE}:1:1`, // cold — never cached below
      `    at file://${SERVER_WRAPPER_FILE}:969:31`, // cached synthetic
    ].join('\n');
    const wrapperFiber = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugStack: stack,
      _debugOwner: null,
    } as unknown as Fiber;
    serverSourceMapCache.set(`${SERVER_WRAPPER_FILE}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    // SERVER_MAIN_FILE:1:1 deliberately left uncached (cold).

    const ancestor = makeFiberWithServerFrame(SERVER_CHAT_INPUT_BAR_FILE, 8, 5);
    wrapperFiber.return = ancestor;
    serverSourceMapCache.set(`${SERVER_CHAT_INPUT_BAR_FILE}:8:5`, {
      fileName: 'src/components/ChatInputBar.tsx',
      line: 8,
      column: 5,
    });

    const result = resolveViaServerSourceMap(wrapperFiber);

    // Not yet settled (a frame on the leaf fiber is still cold) → selectNonSyntheticCachedLocation's
    // frame-order rule already returns not-found for this fiber (in-flight beats a later
    // synthetic hit in the SAME frame list per its own contract), so the walk climbs to the
    // ancestor and finds the real ChatInputBar location — never main.tsx, never stuck.
    expect(result?.fileName).toBe('src/components/ChatInputBar.tsx');
  });

  test('resolveViaClientSourceMap: a genuinely cold fiber (no cached frames at all) still climbs to the ancestor — synthetic-boundary scan does not break this', () => {
    const coldLeaf = makeFiberWithFrame(CHAT_INPUT_BAR_URL, 999, 1); // never cached
    const ancestorUrl = 'http://localhost:5173/src/components/Unrelated.tsx';
    clientSourceMapCache.set(`${ancestorUrl}:3:1`, { fileName: 'src/components/Unrelated.tsx', line: 3, column: 1 });
    const ancestor = makeFiberWithFrame(ancestorUrl, 3, 1);
    coldLeaf.return = ancestor;

    const result = resolveViaClientSourceMap(coldLeaf);

    expect(result).toEqual({ fileName: 'src/components/Unrelated.tsx', line: 3, column: 1 });
  });

  test('resolveViaClientSourceMap: a synthetic hit does NOT stop the walk while an earlier frame on the SAME fiber is still cold (client-side mirror of the server race test)', () => {
    // A single fiber whose _debugStack carries TWO frames: an uncached (cold) frame and
    // an already-cached synthetic-wrapper frame. Must not be treated as a settled
    // boundary — the cold frame could still resolve to something real once warm.
    const CANVAS_PREVIEW_URL = 'http://localhost:5173/src/__canvas_preview__.tsx';
    const stack = new Error();
    stack.stack = [
      'Error',
      `    at ${CHAT_INPUT_BAR_URL}:999:1`, // cold — never cached below
      `    at ${CANVAS_PREVIEW_URL}:969:31`, // cached synthetic
    ].join('\n');
    const wrapperFiber = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugStack: stack,
      _debugOwner: null,
    } as unknown as Fiber;
    clientSourceMapCache.set(`${CANVAS_PREVIEW_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    // CHAT_INPUT_BAR_URL:999:1 deliberately left uncached (cold).

    const ancestorUrl = 'http://localhost:5173/src/components/Unrelated.tsx';
    clientSourceMapCache.set(`${ancestorUrl}:3:1`, { fileName: 'src/components/Unrelated.tsx', line: 3, column: 1 });
    const ancestor = makeFiberWithFrame(ancestorUrl, 3, 1);
    wrapperFiber.return = ancestor;

    const result = resolveViaClientSourceMap(wrapperFiber);

    // Not yet settled (a frame on the leaf fiber is still cold) → the walk must climb to
    // the ancestor instead of committing the synthetic boundary prematurely.
    expect(result).toEqual({ fileName: 'src/components/Unrelated.tsx', line: 3, column: 1 });
  });

  /**
   * Fresh-quorum finding (HYP-1220 follow-up, Opus round 2): the test above proves the walk
   * climbs PAST a cold+synthetic leaf to the ancestor — deliberate and correct when the
   * ancestor is an unrelated component. Opus asked: what if, in the EXACT tamagui-whatsapp
   * shape this ticket targets, that ancestor is the wrapper's OWN mount point, src/main.tsx?
   * Proving this directly: this is NOT a new bug — resolveViaClientSourceMap only answers
   * for ONE fiber's boundary; committing an ancestor's raw hit as the FINAL click source is
   * `resolveClickLocal`'s job, and `resolveClickLocal`'s own synthetic-recovery
   * (`resolveCallSiteTarget` → `recoverNonSyntheticSourceLocation`) runs on the wrapper's
   * `directSource` BEFORE any ancestor is ever committed — recovery finds the real
   * ChatInputBar component via the descendant scan and overrides the synthetic/climbed
   * result, so main.tsx is never reached in the full end-to-end path this ticket's own
   * "resolveClickLocal resolves a real click on a Tamagui-nested div to ChatInputBar.tsx"
   * test (below) already proves. This test pins the NARROWER claim precisely: the raw
   * ancestor walk (resolveViaClientSourceMap alone, no recovery) DOES commit main.tsx when
   * asked directly — documenting the exact code path a caller MUST NOT use standalone
   * (mapOwnFiberSource/mapOrWarmCallSite never do — see their own docs) rather than proving
   * a live click.
   */
  test('resolveViaClientSourceMap ALONE (no recovery layer) commits main.tsx when a cold sibling coexists with a settled synthetic hit — must never be called standalone for a real click', () => {
    const CANVAS_PREVIEW_URL = 'http://localhost:5173/src/__canvas_preview__.tsx';
    const MAIN_URL = 'http://localhost:5173/src/main.tsx';
    const stack = new Error();
    stack.stack = [
      'Error',
      `    at ${CHAT_INPUT_BAR_URL}:999:1`, // cold — never cached below
      `    at ${CANVAS_PREVIEW_URL}:969:31`, // cached synthetic
    ].join('\n');
    const wrapperFiber = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugStack: stack,
      _debugOwner: null,
    } as unknown as Fiber;
    clientSourceMapCache.set(`${CANVAS_PREVIEW_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    clientSourceMapCache.set(`${MAIN_URL}:11:58`, { fileName: 'src/main.tsx', line: 11, column: 58 });
    wrapperFiber.return = makeFiberWithFrame(MAIN_URL, 11, 58);

    const result = resolveViaClientSourceMap(wrapperFiber);

    // Confirms the mechanism the review flagged is real for THIS function in isolation —
    // the resolveClickLocal-level end-to-end recovery test elsewhere in this suite proves
    // it does not surface as a wrong click in the real path.
    expect(result?.fileName).toBe('src/main.tsx');
  });

  /**
   * Review finding on this fix: a fiber whose OWN frames mix a synthetic-wrapper hit
   * with an unresolvable-miss frame (in EITHER order) must still surface the synthetic
   * boundary — two separate chained lookups (a miss-detector, then a synthetic-detector)
   * have an ordering hazard where whichever lookup short-circuits FIRST wins and silently
   * hides the other signal. `classifyOwnClientCallSite`/`classifyOwnServerCallSite`
   * (a single scan per fiber) close this for both frame orderings, both platforms.
   */
  const SYNTHETIC_URL = 'http://localhost:5173/src/__canvas_preview__.tsx';
  const MISS_URL = 'http://localhost:5173/src/components/Unresolvable.tsx';

  function makeMultiFrameClientFiber(frames: Array<{ url: string; line: number; col: number }>): Fiber {
    const stack = new Error();
    stack.stack = ['Error', ...frames.map((f) => `    at ${f.url}:${f.line}:${f.col}`)].join('\n');
    return {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugStack: stack,
      _debugOwner: null,
    } as unknown as Fiber;
  }

  test('resolveViaClientSourceMap: synthetic hit BEFORE a definitive miss on the same fiber still surfaces the boundary', () => {
    clientSourceMapCache.set(`${SYNTHETIC_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    clientSourceMapCache.set(`${MISS_URL}:1:1`, null); // warmed, unresolvable
    const fiber = makeMultiFrameClientFiber([
      { url: SYNTHETIC_URL, line: 969, col: 31 },
      { url: MISS_URL, line: 1, col: 1 },
    ]);

    const result = resolveViaClientSourceMap(fiber);

    expect(result?.fileName).toBe('src/__canvas_preview__.tsx');
  });

  test('resolveViaClientSourceMap: definitive miss BEFORE a synthetic hit on the same fiber still surfaces the boundary', () => {
    clientSourceMapCache.set(`${MISS_URL}:1:1`, null); // warmed, unresolvable
    clientSourceMapCache.set(`${SYNTHETIC_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    const fiber = makeMultiFrameClientFiber([
      { url: MISS_URL, line: 1, col: 1 },
      { url: SYNTHETIC_URL, line: 969, col: 31 },
    ]);

    const result = resolveViaClientSourceMap(fiber);

    expect(result?.fileName).toBe('src/__canvas_preview__.tsx');
  });

  test('resolveViaServerSourceMap: synthetic hit and a definitive miss on the same fiber (either order) still surface the boundary', () => {
    const SERVER_SYNTHETIC = '/repo/.next/server/chunks/wrapper.js';
    const SERVER_MISS = '/repo/.next/server/chunks/unresolvable.js';
    serverSourceMapCache.set(`${SERVER_MISS}:1:1`, null);
    serverSourceMapCache.set(`${SERVER_SYNTHETIC}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    const stack = new Error();
    stack.stack = ['Error', `    at file://${SERVER_MISS}:1:1`, `    at file://${SERVER_SYNTHETIC}:969:31`].join('\n');
    const fiber = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugStack: stack,
      _debugOwner: null,
    } as unknown as Fiber;

    const result = resolveViaServerSourceMap(fiber);

    expect(result?.fileName).toBe('src/__canvas_preview__.tsx');
  });

  /**
   * Review finding (HYP-1220, 3rd-model quorum pass, codex:gpt-5.6-terra): a fiber whose
   * OWN frames are [cold, then a REAL non-synthetic hit] must resolve to that own hit, NOT
   * climb past it to a mapped ancestor. The classifiers used to bail to 'cold' the MOMENT
   * they saw the first uncached frame, so a later same-fiber real hit was silently lost and
   * the walk climbed to `.return` instead — committing the wrong (ancestor) location even
   * though the clicked element's OWN source had already resolved.
   */
  test('resolveViaClientSourceMap: a real hit AFTER a cold frame on the SAME fiber wins — never climbs to a mapped ancestor', () => {
    const COLD_URL = 'http://localhost:5173/src/components/StillWarming.tsx';
    const OWN_HIT_URL = 'http://localhost:5173/src/components/ChatInputBar.tsx';
    const stack = new Error();
    stack.stack = ['Error', `    at ${COLD_URL}:1:1`, `    at ${OWN_HIT_URL}:8:5`].join('\n');
    const fiber = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugStack: stack,
      _debugOwner: null,
    } as unknown as Fiber;
    // COLD_URL:1:1 deliberately left uncached.
    clientSourceMapCache.set(`${OWN_HIT_URL}:8:5`, { fileName: 'src/components/ChatInputBar.tsx', line: 8, column: 5 });

    // A mapped ANCESTOR the walk must never reach — if this fiber's cold frame wrongly
    // caused the walk to climb, the wrong (ancestor) location would come back instead.
    const ancestorUrl = 'http://localhost:5173/src/components/WrongAncestor.tsx';
    clientSourceMapCache.set(`${ancestorUrl}:3:1`, {
      fileName: 'src/components/WrongAncestor.tsx',
      line: 3,
      column: 1,
    });
    fiber.return = makeFiberWithFrame(ancestorUrl, 3, 1);

    const result = resolveViaClientSourceMap(fiber);

    expect(result?.fileName).toBe('src/components/ChatInputBar.tsx');
    expect(result?.fileName).not.toBe('src/components/WrongAncestor.tsx');
  });

  test('resolveViaServerSourceMap: a real hit AFTER a cold frame on the SAME fiber wins — never climbs to a mapped ancestor (server-side mirror)', () => {
    const SERVER_COLD_FILE = '/repo/.next/server/chunks/still-warming.js';
    const SERVER_OWN_HIT_FILE = '/repo/.next/server/chunks/chat-input-bar.js';
    const stack = new Error();
    stack.stack = ['Error', `    at file://${SERVER_COLD_FILE}:1:1`, `    at file://${SERVER_OWN_HIT_FILE}:8:5`].join(
      '\n',
    );
    const fiber = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugStack: stack,
      _debugOwner: null,
    } as unknown as Fiber;
    // SERVER_COLD_FILE:1:1 deliberately left uncached.
    serverSourceMapCache.set(`${SERVER_OWN_HIT_FILE}:8:5`, {
      fileName: 'src/components/ChatInputBar.tsx',
      line: 8,
      column: 5,
    });

    const ancestorFile = '/repo/.next/server/chunks/wrong-ancestor.js';
    serverSourceMapCache.set(`${ancestorFile}:3:1`, {
      fileName: 'src/components/WrongAncestor.tsx',
      line: 3,
      column: 1,
    });
    fiber.return = makeFiberWithServerFrame(ancestorFile, 3, 1);

    const result = resolveViaServerSourceMap(fiber);

    expect(result?.fileName).toBe('src/components/ChatInputBar.tsx');
    expect(result?.fileName).not.toBe('src/components/WrongAncestor.tsx');
  });

  /**
   * Review finding on this fix (HYP-1220 follow-up): an untested `[synthetic-hit, cold]`
   * frame ORDER — the synthetic hit comes FIRST in the stack, the still-warming frame
   * SECOND — flagged as a case that could, in principle, reproduce the exact main.tsx-leak
   * shape HYP-1220 exists to close if a naive scan let the first-seen synthetic hit
   * short-circuit before noticing a later cold frame. The existing tests above only cover
   * the REVERSE order (`[cold, synthetic]`). `classifyOwnClientCallSite`/
   * `classifyOwnServerCallSite`'s post-loop `sawCold` check fires regardless of scan order,
   * so this must still climb to the ancestor instead of committing the synthetic boundary.
   */
  test('resolveViaClientSourceMap: [synthetic-hit, cold] order — a synthetic hit BEFORE a cold frame still does not settle, walk climbs to the ancestor', () => {
    const CANVAS_PREVIEW_URL = 'http://localhost:5173/src/__canvas_preview__.tsx';
    const COLD_URL = 'http://localhost:5173/src/components/StillWarming2.tsx';
    const stack = new Error();
    stack.stack = ['Error', `    at ${CANVAS_PREVIEW_URL}:969:31`, `    at ${COLD_URL}:1:1`].join('\n');
    const wrapperFiber = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugStack: stack,
      _debugOwner: null,
    } as unknown as Fiber;
    clientSourceMapCache.set(`${CANVAS_PREVIEW_URL}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    // COLD_URL:1:1 deliberately left uncached (cold).

    const ancestorUrl = 'http://localhost:5173/src/components/Unrelated.tsx';
    clientSourceMapCache.set(`${ancestorUrl}:3:1`, { fileName: 'src/components/Unrelated.tsx', line: 3, column: 1 });
    wrapperFiber.return = makeFiberWithFrame(ancestorUrl, 3, 1);

    const result = resolveViaClientSourceMap(wrapperFiber);

    expect(result).toEqual({ fileName: 'src/components/Unrelated.tsx', line: 3, column: 1 });
  });

  test('resolveViaServerSourceMap: [synthetic-hit, cold] order — a synthetic hit BEFORE a cold frame still does not settle, walk climbs to the ancestor (server-side mirror)', () => {
    const SERVER_SYNTHETIC = '/repo/.next/server/chunks/wrapper2.js';
    const SERVER_COLD_FILE = '/repo/.next/server/chunks/still-warming-2.js';
    const stack = new Error();
    stack.stack = ['Error', `    at file://${SERVER_SYNTHETIC}:969:31`, `    at file://${SERVER_COLD_FILE}:1:1`].join(
      '\n',
    );
    const wrapperFiber = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugStack: stack,
      _debugOwner: null,
    } as unknown as Fiber;
    serverSourceMapCache.set(`${SERVER_SYNTHETIC}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    // SERVER_COLD_FILE:1:1 deliberately left uncached (cold).

    const ancestor = makeFiberWithServerFrame(SERVER_CHAT_INPUT_BAR_FILE, 8, 5);
    wrapperFiber.return = ancestor;
    serverSourceMapCache.set(`${SERVER_CHAT_INPUT_BAR_FILE}:8:5`, {
      fileName: 'src/components/ChatInputBar.tsx',
      line: 8,
      column: 5,
    });

    const result = resolveViaServerSourceMap(wrapperFiber);

    expect(result?.fileName).toBe('src/components/ChatInputBar.tsx');
  });
});
