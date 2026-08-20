/**
 * @file HYP-1280 — A1 forward-detector facts reaching the SaaS browser read path.
 *
 * Accessed via: bun test client/lib/platform/hooks/useElementStyleData.forwarding.test.ts
 * Covers: (1) `fetchComponentPropSurface` calls the new GET /api/element-forwarding route with
 * the right query shape and parses its response; (2) the `useElementStyleData` hook's browser-
 * mode wiring — resets on selection change, re-fetches on `refreshKey`, discards a stale response
 * for an already-abandoned selection, and never fires in VS Code mode; and (3) as a COMPOSITION
 * PROOF (not a claim about shipped enforcement — nothing in production wires this yet, tracked as
 * HYP-1294), that the resulting `componentPropSurface` — for a non-forwarding wrapper component,
 * exactly the shape server/routes/readElementForwarding.test.ts proves the real detector produces
 * — resolves to rung L3 (no write channel) when manually piped through the existing, still-STAGED
 * shared ladder (`lib/style-write/stylability-ladder.ts`'s `resolveStyleSurface`). Mirrors the
 * extension-side unit coverage in lib/style-read/forward-detect.test.ts, but for the browser path.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ComponentPropSurfaceFacts, InspectorSurfaceDecision } from '@lib/style-read/types';
import { resolveStyleSurface } from '@lib/style-write/stylability-ladder';
import type { CanvasAdapter } from '../types';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { StyleAdapter } from '@/lib/canvas-engine/adapters/StyleAdapter';
import { fetchComponentPropSurface, useElementStyleData } from './useElementStyleData';

const NEUTRAL_SURFACE_DECISION: InspectorSurfaceDecision = {
  standardStyleInspector: 'enabled',
  propsEditor: 'hidden',
  reasons: [],
};

describe('fetchComponentPropSurface (browser/SaaS mode)', () => {
  const originalFetch = globalThis.fetch;
  let lastRequestUrl: string | undefined;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch(componentPropSurface: ComponentPropSurfaceFacts) {
    lastRequestUrl = undefined;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      lastRequestUrl = String(input);
      return new Response(JSON.stringify({ success: true, componentPropSurface }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  }

  test('requests the route with filePath + nodeRef and returns the parsed facts', async () => {
    stubFetch({
      acceptsClassName: true,
      acceptsStyle: true,
      acceptsCssProp: false,
      acceptsSxProp: false,
      recursivePropsSchemaAvailable: false,
      styleLikeProps: [],
      semanticProps: [],
    });
    const controller = new AbortController();
    const facts = await fetchComponentPropSurface(
      '/project/src/App.tsx',
      'App.tsx:3:2',
      undefined,
      controller.signal,
    );
    expect(facts?.acceptsClassName).toBe(true);
    expect(lastRequestUrl).toContain('/api/element-forwarding?');
    expect(lastRequestUrl).toContain('filePath=%2Fproject%2Fsrc%2FApp.tsx');
    expect(lastRequestUrl).toContain('nodeRef=App.tsx%3A3%3A2');
  });

  test('includes elementLocLine/elementLocColumn in the query when elementLoc is supplied', async () => {
    stubFetch({
      acceptsClassName: true,
      acceptsStyle: true,
      acceptsCssProp: false,
      acceptsSxProp: false,
      recursivePropsSchemaAvailable: false,
      styleLikeProps: [],
      semanticProps: [],
    });
    const controller = new AbortController();
    await fetchComponentPropSurface('/project/src/App.tsx', 'App.tsx:3:2', { line: 12, column: 4 }, controller.signal);
    expect(lastRequestUrl).toContain('elementLocLine=12');
    expect(lastRequestUrl).toContain('elementLocColumn=4');
  });

  test('a failed fetch resolves to null (fail-open — never blocks the caller)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    const facts = await fetchComponentPropSurface('/project/src/App.tsx', 'nodeRef', undefined, controller.signal);
    expect(facts).toBeNull();
  });

  test('a non-2xx response resolves to null (the real shape every route failure produces — errorHandler, not a 200 success:false body)', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: 'NOT_FOUND', error: 'Element not found' }), {
        status: 404,
      })) as unknown as typeof fetch;
    const controller = new AbortController();
    const facts = await fetchComponentPropSurface('/project/src/App.tsx', 'nodeRef', undefined, controller.signal);
    expect(facts).toBeNull();
  });
});

describe('HYP-1280 — SaaS browser facts feed the shared write planner as a pre-write exclusion', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          // A fully non-forwarding component: neither channel reaches the DOM (e.g. a `<Layout
          // title>` that destructures neither className nor style, no rest spread) — the
          // component-prop-surface shape server/routes/readElementForwarding.test.ts proves the
          // real A1 detector produces for that fixture class.
          componentPropSurface: {
            acceptsClassName: false,
            acceptsStyle: false,
            acceptsCssProp: false,
            acceptsSxProp: false,
            recursivePropsSchemaAvailable: false,
            styleLikeProps: [],
            semanticProps: [],
          } satisfies ComponentPropSurfaceFacts,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as unknown as typeof fetch;
  });

  test('no forwarding channel at all excludes the write — resolveStyleSurface returns L3, no channel', async () => {
    const controller = new AbortController();
    const facts = await fetchComponentPropSurface(
      '/project/src/App.tsx',
      'App.tsx:5:4',
      undefined,
      controller.signal,
    );
    if (!facts) throw new Error('expected facts');

    // This is the exact fact the stylability ladder (the shared write planner, staged for the
    // ast:updateStylesBatch host handler — lib/style-write/stylability-ladder.ts's file header)
    // reads to decide whether an edit can land: with no style channel and no partial-prop cover,
    // it resolves to L3 — excluded, no write target — never a blind write onto a dropped prop.
    const resolution = resolveStyleSurface(NEUTRAL_SURFACE_DECISION, facts, 'backgroundColor');
    expect(resolution).toEqual({ rung: 'L3' });
  });
});

// --- Hook-level wiring: reset-on-change + stale-response discard --------------------------------

/** An engine with no AST/DOM structure — `readBrowserElementStyle`'s main read returns EMPTY_DATA,
 *  so these tests exercise ONLY the forwarding effect in isolation. */
function makeEmptyEngine(): CanvasEngine {
  return {
    getRoot: () => ({ children: [], metadata: {} }),
    getInstance: () => undefined,
  } as unknown as CanvasEngine;
}

const NOOP_STYLE_ADAPTER = {} as StyleAdapter;

function forwardingResponse(acceptsClassName: boolean): Response {
  return new Response(
    JSON.stringify({
      success: true,
      componentPropSurface: {
        acceptsClassName,
        acceptsStyle: true,
        acceptsCssProp: false,
        acceptsSxProp: false,
        recursivePropsSchemaAvailable: false,
        styleLikeProps: [],
        semanticProps: [],
      } satisfies ComponentPropSurfaceFacts,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('HYP-1280 — useElementStyleData hook wiring (browser/SaaS mode)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('resets componentPropSurface synchronously on element change (real coverage: a value is set FIRST, then cleared)', async () => {
    const pending = new Map<string, (response: Response) => void>();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = url.includes('nodeRef=first') ? 'first' : 'second';
      return new Promise<Response>((resolve) => pending.set(key, resolve));
    }) as unknown as typeof fetch;

    const engine = makeEmptyEngine();
    const { result, rerender } = renderHook(
      (elementId: string) =>
        useElementStyleData({
          elementId,
          componentPath: '/project/src/App.tsx',
          engine,
          styleAdapter: NOOP_STYLE_ADAPTER,
        }),
      { initialProps: 'first' },
    );

    // 'first' resolves BEFORE the switch — componentPropSurface has a real, defined value, so the
    // assertion after rerender below actually exercises the reset branch (k3 review finding:
    // without this step the field was already undefined and the test passed vacuously).
    pending.get('first')?.(forwardingResponse(true));
    await waitFor(() => expect(result.current.componentPropSurface?.acceptsClassName).toBe(true));

    rerender('second');
    expect(result.current.componentPropSurface).toBeUndefined();

    pending.get('second')?.(forwardingResponse(false));
    await waitFor(() => expect(result.current.componentPropSurface?.acceptsClassName).toBe(false));
  });

  test('discards a late-arriving response for an already-abandoned selection', async () => {
    const pending = new Map<string, (response: Response) => void>();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = url.includes('nodeRef=first') ? 'first' : 'second';
      return new Promise<Response>((resolve) => pending.set(key, resolve));
    }) as unknown as typeof fetch;

    const engine = makeEmptyEngine();
    const { result, rerender } = renderHook(
      (elementId: string) =>
        useElementStyleData({
          elementId,
          componentPath: '/project/src/App.tsx',
          engine,
          styleAdapter: NOOP_STYLE_ADAPTER,
        }),
      { initialProps: 'first' },
    );

    // Switch away from 'first' while its request is still in flight — cleanup aborts its
    // controller. Neither request has resolved yet.
    rerender('second');
    pending.get('second')?.(forwardingResponse(false));
    await waitFor(() => expect(result.current.componentPropSurface?.acceptsClassName).toBe(false));

    // 'first' resolves LATE, after 'second' already landed — must be ignored (aborted signal),
    // not overwrite 'second's already-applied value.
    pending.get('first')?.(forwardingResponse(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.componentPropSurface?.acceptsClassName).toBe(false);
  });

  test('re-fetches when refreshKey bumps (matching the sibling read effect\'s invalidation contract)', async () => {
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount++;
      return forwardingResponse(requestCount === 1);
    }) as unknown as typeof fetch;

    const engine = makeEmptyEngine();
    const { result, rerender } = renderHook(
      (refreshKey: number) =>
        useElementStyleData({
          elementId: 'App.tsx:1:0',
          componentPath: '/project/src/App.tsx',
          engine,
          styleAdapter: NOOP_STYLE_ADAPTER,
          refreshKey,
        }),
      { initialProps: 0 },
    );

    await waitFor(() => expect(result.current.componentPropSurface?.acceptsClassName).toBe(true));
    expect(requestCount).toBe(1);

    rerender(1);
    await waitFor(() => expect(requestCount).toBe(2));
    await waitFor(() => expect(result.current.componentPropSurface?.acceptsClassName).toBe(false));
  });

  test('VS Code mode (no engine) never fires the forwarding fetch', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return forwardingResponse(true);
    }) as unknown as typeof fetch;

    renderHook(() =>
      useElementStyleData({
        elementId: 'App.tsx:1:0',
        componentPath: '/project/src/App.tsx',
        engine: null,
        styleAdapter: null,
        canvas: null,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchCalled).toBe(false);
  });
});

// --- HYP-1294 AC2: VS Code parity — componentPropSurface arrives via styles:response RPC --------

/** Minimal canvas mock that routes styles:response to registered handlers (mirrors the pattern in
 *  useElementStyleData.test.ts's VS-Code-mode describe block). */
function makeCanvas() {
  const responseHandlers = new Set<(msg: unknown) => void>();
  const sent: Array<{ type: string; requestId?: string }> = [];

  const canvas: CanvasAdapter = {
    onEvent(type: string, handler: (msg: unknown) => void) {
      if (type === 'styles:response') {
        responseHandlers.add(handler);
        return () => {
          responseHandlers.delete(handler);
        };
      }
      return () => {};
    },
    sendEvent(msg: unknown) {
      sent.push(msg as { type: string; requestId?: string });
    },
  } as unknown as CanvasAdapter;

  const emitResponse = (overrides: Record<string, unknown> = {}) => {
    const req = [...sent].reverse().find((m) => m.type === 'styles:readClassName');
    const payload = {
      requestId: req?.requestId,
      success: true,
      className: '',
      tagType: 'Layout',
      textContent: '',
      ...overrides,
    };
    for (const h of responseHandlers) h(payload);
  };

  return { canvas, emitResponse };
}

describe('HYP-1294 AC2 — VS Code mode surfaces componentPropSurface via styles:response', () => {
  test('a styles:response carrying componentPropSurface reaches the hook result', async () => {
    const { canvas, emitResponse } = makeCanvas();
    const nonForwarding: ComponentPropSurfaceFacts = {
      acceptsClassName: false,
      acceptsStyle: false,
      acceptsCssProp: false,
      acceptsSxProp: false,
      recursivePropsSchemaAvailable: false,
      styleLikeProps: [],
      semanticProps: [],
    };

    const { result } = renderHook(() =>
      useElementStyleData({
        elementId: 'src/App.tsx:5:3',
        componentPath: 'src/App.tsx',
        canvas,
        engine: null,
        styleAdapter: null,
      }),
    );

    expect(result.current.componentPropSurface).toBeUndefined();
    act(() => emitResponse({ componentPropSurface: nonForwarding }));
    await waitFor(() => expect(result.current.componentPropSurface).toEqual(nonForwarding));
  });

  test('resets componentPropSurface to undefined on selection change (VS Code mode)', async () => {
    const { canvas, emitResponse } = makeCanvas();
    const forwarding: ComponentPropSurfaceFacts = {
      acceptsClassName: true,
      acceptsStyle: true,
      acceptsCssProp: false,
      acceptsSxProp: false,
      recursivePropsSchemaAvailable: false,
      styleLikeProps: [],
      semanticProps: [],
    };

    const { result, rerender } = renderHook(
      (props: { elementId: string }) =>
        useElementStyleData({ ...props, componentPath: 'src/App.tsx', canvas, engine: null, styleAdapter: null }),
      { initialProps: { elementId: 'src/App.tsx:5:3' } },
    );

    act(() => emitResponse({ componentPropSurface: forwarding }));
    await waitFor(() => expect(result.current.componentPropSurface).toEqual(forwarding));

    rerender({ elementId: 'src/App.tsx:9:1' });
    expect(result.current.componentPropSurface).toBeUndefined();
  });

  // Review finding (2nd round, Opus) — untested path: a refetch of the SAME element (refreshKey
  // bump) whose response carries NO componentPropSurface at all (the "selection lost after HMR"
  // empty-result shape StyleReadService.readElementClassName returns) must KEEP the last known
  // verdict, not clobber it to undefined — mirrors the pre-existing `i18nText ?? prev.i18nText`
  // idiom on the line above the new `setComponentPropSurface` call.
  test('a refetch response with no componentPropSurface field keeps the previous verdict (VS Code mode)', async () => {
    const { canvas, emitResponse } = makeCanvas();
    const nonForwarding: ComponentPropSurfaceFacts = {
      acceptsClassName: false,
      acceptsStyle: false,
      acceptsCssProp: false,
      acceptsSxProp: false,
      recursivePropsSchemaAvailable: false,
      styleLikeProps: [],
      semanticProps: [],
    };

    const { result, rerender } = renderHook(
      (props: { refreshKey: number }) =>
        useElementStyleData({
          elementId: 'src/App.tsx:5:3',
          componentPath: 'src/App.tsx',
          canvas,
          engine: null,
          styleAdapter: null,
          refreshKey: props.refreshKey,
        }),
      { initialProps: { refreshKey: 0 } },
    );

    act(() => emitResponse({ componentPropSurface: nonForwarding }));
    await waitFor(() => expect(result.current.componentPropSurface).toEqual(nonForwarding));

    // Same element, new refreshKey — a fresh requestId, response has NO componentPropSurface key.
    rerender({ refreshKey: 1 });
    act(() => emitResponse({ componentPropSurface: undefined }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.componentPropSurface).toEqual(nonForwarding);
  });
});
