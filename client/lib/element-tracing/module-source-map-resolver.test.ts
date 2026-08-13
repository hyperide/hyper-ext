import { describe, expect, it, mock, spyOn } from 'bun:test';
import type { LocalResolveResult } from '../../../shared/canvas-interaction/types';
import type { Fiber } from '../../../shared/element-tracing/fiber-internals';
import { ClickRetryQueue } from './click-retry-queue';
import { ModuleSourceMapResolver } from './module-source-map-resolver';

// ─── VLQ encoding helpers (same encoding as shared/element-tracing/__tests__/source-map-resolver.test.ts) ───

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value: number): string {
  let sv = value < 0 ? (-value << 1) | 1 : value << 1;
  let result = '';
  do {
    let digit = sv & 31;
    sv >>= 5;
    if (sv > 0) digit |= 32;
    result += BASE64[digit];
  } while (sv > 0);
  return result;
}

function encodeSegment(fields: number[]): string {
  return fields.map(encodeVlq).join('');
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROXIED_MODULE_URL =
  'http://localhost:8080/project-preview/0a1b2c3d-4e5f-6789-abcd-ef0123456789/src/components/Hero.tsx?t=1760000000000';

/**
 * Inline source map: generated line 19 col 20 (0-based) → original line 3 (0-based)
 * col 6, source `/app/src/components/Hero.tsx` (container-absolute, as Vite emits).
 * Mirrors the live diagnosis: transformed Hero.tsx:19:21 ↔ source 4:6.
 */
function makeModuleBody(): string {
  const mappings = `${';'.repeat(18)}${encodeSegment([20, 0, 3, 6])}`;
  const sm = { version: 3, sources: ['/app/src/components/Hero.tsx'], mappings };
  const encoded = btoa(JSON.stringify(sm));
  return `const x = 1;\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
}

function mockFiberWithStack(url: string, line: number, col: number): Fiber {
  const err = {
    stack: `Error\n    at jsxDEV (http://localhost:8080/project-preview/0a1b2c3d-4e5f-6789-abcd-ef0123456789/node_modules/.vite/deps/react_jsx-dev-runtime.js:1:100)\n    at Hero (${url}:${line}:${col})`,
  } as Error;
  return {
    tag: 5,
    type: 'h1',
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    memoizedProps: {},
    _debugStack: err,
    _debugOwner: null,
  } as Fiber;
}

function fetchReturning(body: string): typeof fetch {
  return mock(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
}

/**
 * Inline source map with caller-controlled fields: generated line 29 col 20 (0-based)
 * → original line 5 (0-based) col 6. Mirrors the live HYP-594 repro: transformed
 * Hero.tsx:29:21 ↔ source 6:6.
 */
function makeModuleBodyWith(sm: Record<string, unknown>): string {
  const mappings = `${';'.repeat(28)}${encodeSegment([20, 0, 5, 6])}`;
  const encoded = btoa(JSON.stringify({ version: 3, mappings, ...sm }));
  return `const x = 1;\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ModuleSourceMapResolver', () => {
  it('maps transformed coords to original source coords through an inline source map', async () => {
    const fetchFn = fetchReturning(makeModuleBody());
    const onResolved = mock(() => {});
    const resolver = new ModuleSourceMapResolver({ fetchFn, onResolved });
    const fiber = mockFiberWithStack(PROXIED_MODULE_URL, 19, 21);

    // Cold cache: returns null (caller falls back to raw parseDebugStack) and warms in background
    expect(resolver.resolveFiberSource(fiber)).toBeNull();

    await resolver.flush();
    expect(onResolved).toHaveBeenCalled();

    // Warm cache: transformed 19:21 → original 4:6, container + proxy prefixes stripped
    const loc = resolver.resolveFiberSource(fiber);
    expect(loc).toEqual({ fileName: 'src/components/Hero.tsx', line: 4, column: 6 });
  });

  it('walks up the return chain to the nearest fiber with _debugStack', async () => {
    const fetchFn = fetchReturning(makeModuleBody());
    const resolver = new ModuleSourceMapResolver({ fetchFn });
    const parent = mockFiberWithStack(PROXIED_MODULE_URL, 19, 21);
    const child = {
      tag: 6,
      type: null,
      stateNode: null,
      return: parent,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugOwner: null,
    } as Fiber;

    expect(resolver.resolveFiberSource(child)).toBeNull();
    await resolver.flush();
    expect(resolver.resolveFiberSource(child)).toEqual({ fileName: 'src/components/Hero.tsx', line: 4, column: 6 });
  });

  it('fetches each module URL only once for multiple positions', async () => {
    const fetchFn = fetchReturning(makeModuleBody());
    const resolver = new ModuleSourceMapResolver({ fetchFn });

    resolver.resolveFiberSource(mockFiberWithStack(PROXIED_MODULE_URL, 19, 21));
    resolver.resolveFiberSource(mockFiberWithStack(PROXIED_MODULE_URL, 19, 30));
    await resolver.flush();

    expect((fetchFn as unknown as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  it('caches a failed fetch as unresolvable without throwing', async () => {
    const fetchFn = mock(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const resolver = new ModuleSourceMapResolver({ fetchFn });
    const fiber = mockFiberWithStack(PROXIED_MODULE_URL, 19, 21);

    // Capture the intentional failed-fetch debug log — test output must stay pristine.
    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      expect(resolver.resolveFiberSource(fiber)).toBeNull();
      await resolver.flush();
      // Warmed-but-unresolvable: stays null, no retry storm
      expect(resolver.resolveFiberSource(fiber)).toBeNull();
      expect((fetchFn as unknown as ReturnType<typeof mock>).mock.calls.length).toBe(1);
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('[tracing]'))).toBe(true);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('reports warming state per fiber module while the map fetch is in flight (HYP-635)', async () => {
    const fetchFn = fetchReturning(makeModuleBody());
    const resolver = new ModuleSourceMapResolver({ fetchFn });
    const fiber = mockFiberWithStack(PROXIED_MODULE_URL, 19, 21);

    // Nothing requested yet — not warming.
    expect(resolver.isFiberSourceWarming(fiber)).toBe(false);

    // Cold resolve kicks off the background fetch — now warming.
    resolver.resolveFiberSource(fiber);
    expect(resolver.isFiberSourceWarming(fiber)).toBe(true);

    await resolver.flush();
    expect(resolver.isFiberSourceWarming(fiber)).toBe(false);
  });

  it('onResolved observes the module as no longer warming (codex P1: retry queue pumps from it)', async () => {
    // ClickRetryQueue.notifyResolved() runs inside onResolved and skips re-resolution
    // while the element's module is still warming. If pending were cleared only AFTER
    // onResolved (the old .finally ordering), the queued click would never retry.
    const fetchFn = fetchReturning(makeModuleBody());
    const fiber = mockFiberWithStack(PROXIED_MODULE_URL, 19, 21);
    const warmingInsideCallback: boolean[] = [];
    const resolver: ModuleSourceMapResolver = new ModuleSourceMapResolver({
      fetchFn,
      onResolved: () => warmingInsideCallback.push(resolver.isFiberSourceWarming(fiber)),
    });

    resolver.resolveFiberSource(fiber);
    await resolver.flush();

    expect(warmingInsideCallback).toEqual([false]);
  });

  it('integration: a click queued during warmup re-resolves when the map lands, no second click (HYP-635)', async () => {
    // Full chain as wired by useElementTracer: resolver.onResolved pumps the queue;
    // queue.isWarming probes the resolver; queue.resolve succeeds only once the
    // module map yields ORIGINAL coords (stand-in for the node-map match).
    const fetchFn = fetchReturning(makeModuleBody());
    const fiber = mockFiberWithStack(PROXIED_MODULE_URL, 19, 21);
    const element = document.createElement('div');
    const delivered: LocalResolveResult[] = [];

    let queue: ClickRetryQueue | null = null;
    const resolver = new ModuleSourceMapResolver({
      fetchFn,
      onResolved: () => queue?.notifyResolved(),
    });
    queue = new ClickRetryQueue({
      isWarming: () => resolver.isFiberSourceWarming(fiber),
      resolve: () => {
        const loc = resolver.resolveFiberSource(fiber);
        return loc === null ? null : ({ nodeRef: `${loc.fileName}:${loc.line}:${loc.column}` } as LocalResolveResult);
      },
    });

    // First click during warmup: cold resolve kicks off the fetch and misses the node map.
    expect(resolver.resolveFiberSource(fiber)).toBeNull();
    expect(queue.enqueue(element, (result) => delivered.push(result))).toBe(true);
    expect(delivered).toHaveLength(0);

    // Map lands → onResolved → queued click re-resolves with mapped coords. No second click.
    await resolver.flush();
    expect(delivered.map((r) => r.nodeRef)).toEqual(['src/components/Hero.tsx:4:6']);
  });

  it('warmFiberTree pre-warms every fiber with a _debugStack', async () => {
    const fetchFn = fetchReturning(makeModuleBody());
    const resolver = new ModuleSourceMapResolver({ fetchFn });
    const root = mockFiberWithStack(PROXIED_MODULE_URL, 19, 21);

    resolver.warmFiberTree(root);
    await resolver.flush();

    expect(resolver.resolveFiberSource(root)).toEqual({ fileName: 'src/components/Hero.tsx', line: 4, column: 6 });
  });

  // PROVEN root cause of HYP-594 selection-outline miss: Vite per-module transform maps
  // carry `sources: ["Hero.tsx"]` — basename only. Per the source-map spec, sources resolve
  // against the module URL; the result must then be normalized to a project-relative path
  // (origin + /project-preview/<id>/ proxy prefix stripped, ?t= vite timestamp dropped).
  it('resolves basename-only map sources against the module URL (Vite transform maps)', async () => {
    const fetchFn = fetchReturning(makeModuleBodyWith({ sources: ['Hero.tsx'] }));
    const resolver = new ModuleSourceMapResolver({ fetchFn });
    const fiber = mockFiberWithStack(PROXIED_MODULE_URL, 29, 21);

    expect(resolver.resolveFiberSource(fiber)).toBeNull();
    await resolver.flush();
    expect(resolver.resolveFiberSource(fiber)).toEqual({ fileName: 'src/components/Hero.tsx', line: 6, column: 6 });
  });

  it('applies sourceRoot before resolving sources (container-absolute root)', async () => {
    const fetchFn = fetchReturning(makeModuleBodyWith({ sourceRoot: '/app/src/components/', sources: ['Hero.tsx'] }));
    const resolver = new ModuleSourceMapResolver({ fetchFn });
    const fiber = mockFiberWithStack(PROXIED_MODULE_URL, 29, 21);

    resolver.resolveFiberSource(fiber);
    await resolver.flush();
    expect(resolver.resolveFiberSource(fiber)).toEqual({ fileName: 'src/components/Hero.tsx', line: 6, column: 6 });
  });

  it('treats a root sourceRoot ("/") as origin-root, not the module directory (codex P2)', async () => {
    // sourceRoot "/" + "src/components/Hero.tsx" must resolve to /src/components/Hero.tsx,
    // NOT to <module dir>/src/components/Hero.tsx ("src/components/src/components/Hero.tsx").
    const fetchFn = fetchReturning(makeModuleBodyWith({ sourceRoot: '/', sources: ['src/components/Hero.tsx'] }));
    const resolver = new ModuleSourceMapResolver({ fetchFn });
    const fiber = mockFiberWithStack(PROXIED_MODULE_URL, 29, 21);

    resolver.resolveFiberSource(fiber);
    await resolver.flush();
    expect(resolver.resolveFiberSource(fiber)).toEqual({ fileName: 'src/components/Hero.tsx', line: 6, column: 6 });
  });

  it('ignores sourceRoot for absolute sources (spec: absolute paths bypass the root)', async () => {
    const fetchFn = fetchReturning(
      makeModuleBodyWith({ sourceRoot: '/somewhere/else/', sources: ['/app/src/components/Hero.tsx'] }),
    );
    const resolver = new ModuleSourceMapResolver({ fetchFn });
    const fiber = mockFiberWithStack(PROXIED_MODULE_URL, 29, 21);

    resolver.resolveFiberSource(fiber);
    await resolver.flush();
    expect(resolver.resolveFiberSource(fiber)).toEqual({ fileName: 'src/components/Hero.tsx', line: 6, column: 6 });
  });

  it('resolves a relative sourceRoot against the module URL directory', async () => {
    // sourceRoot ".." + "components/Hero.tsx" from .../src/components/Hero.tsx?t=…
    // → .../src/components/Hero.tsx after URL resolution (query dropped).
    const fetchFn = fetchReturning(makeModuleBodyWith({ sourceRoot: '..', sources: ['components/Hero.tsx'] }));
    const resolver = new ModuleSourceMapResolver({ fetchFn });
    const fiber = mockFiberWithStack(PROXIED_MODULE_URL, 29, 21);

    resolver.resolveFiberSource(fiber);
    await resolver.flush();
    expect(resolver.resolveFiberSource(fiber)).toEqual({ fileName: 'src/components/Hero.tsx', line: 6, column: 6 });
  });

  it('ignores fibers whose stack has no fetchable module frame', () => {
    const fetchFn = fetchReturning(makeModuleBody());
    const resolver = new ModuleSourceMapResolver({ fetchFn });
    const fiber = {
      tag: 5,
      type: 'div',
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugStack: { stack: 'Error\n    at <anonymous>:1:1' } as Error,
      _debugOwner: null,
    } as Fiber;

    expect(resolver.resolveFiberSource(fiber)).toBeNull();
    expect((fetchFn as unknown as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});
