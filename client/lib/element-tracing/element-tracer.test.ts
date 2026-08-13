import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DebugSource, Fiber } from '../../../shared/element-tracing/fiber-internals';
import type {
  FrameworkAdapter,
  NodeMapEntry,
  NodeMapUpdate,
  TracingClientMessage,
  TracingServerMessage,
  TracingTransport,
} from '../../../shared/element-tracing/types';
import { ElementTracer } from './element-tracer';

function mockFiber(overrides: Partial<Fiber> = {}): Fiber {
  return {
    tag: 5,
    type: 'div',
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    memoizedProps: {},
    _debugSource: null,
    _debugOwner: null,
    ...overrides,
  };
}

function attachFiber(element: HTMLElement, fiber: Fiber): HTMLElement {
  (element as HTMLElement & Record<'__reactFiber$test', Fiber>).__reactFiber$test = fiber;
  return element;
}

function mockAdapter(overrides: Partial<FrameworkAdapter> = {}): FrameworkAdapter {
  return {
    name: 'react',
    detect: () => true,
    getSourceLocation: () => ({ fileName: 'App.tsx', line: 10, column: 4 }),
    getComponentChain: () => [],
    getItemIndex: () => 0,
    walkComponentTree: () => [],
    findDOMElement: () => null,
    ...overrides,
  };
}

function mockTransport(): TracingTransport & {
  handlers: Set<(msg: TracingServerMessage) => void>;
  sent: TracingClientMessage[];
  simulateMessage(msg: TracingServerMessage): void;
} {
  const handlers = new Set<(msg: TracingServerMessage) => void>();
  const connHandlers = new Set<(connected: boolean) => void>();
  const sent: TracingClientMessage[] = [];
  return {
    connected: true,
    handlers,
    sent,
    send(msg) {
      sent.push(msg);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onConnectionChange(handler) {
      connHandlers.add(handler);
      return () => connHandlers.delete(handler);
    },
    simulateMessage(msg) {
      for (const h of handlers) h(msg);
    },
  };
}

describe('ElementTracer', () => {
  let tracer: ElementTracer;
  let adapter: FrameworkAdapter;
  let transport: ReturnType<typeof mockTransport>;

  beforeEach(() => {
    adapter = mockAdapter();
    transport = mockTransport();
    tracer = new ElementTracer(adapter, transport);
  });

  it('should resolve click to source location via adapter', () => {
    const result = tracer.resolveClick({} as HTMLElement);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.source.fileName).toBe('App.tsx');
    expect(result.source.line).toBe(10);
    expect(result.itemIndex).toBe(0);
  });

  it('should send resolve-element to transport on click', () => {
    tracer.resolveClick({} as HTMLElement);
    expect(transport.sent.length).toBe(1);
    expect(transport.sent[0].type).toBe('resolve-element');
  });

  it('should return null when adapter returns no source', () => {
    adapter = mockAdapter({ getSourceLocation: () => null });
    tracer = new ElementTracer(adapter, transport);
    expect(tracer.resolveClick({} as HTMLElement)).toBeNull();
  });

  it('should store received node maps', () => {
    const update: NodeMapUpdate = {
      type: 'node-map-update',
      filePath: 'src/App.tsx',
      fileHash: 'abc',
      version: 1,
      nodes: [
        {
          nodeRef: 'src/App.tsx:0',
          tag: 'div',
          loc: { fileName: 'src/App.tsx', line: 5, column: 4 },
          endLoc: { fileName: 'src/App.tsx', line: 10, column: 10 },
          parentRef: null,
          children: [],
          isComponent: false,
          fingerprint: '0000',
        },
      ],
    };
    transport.simulateMessage(update);
    const nodeMap = tracer.getNodeMap('src/App.tsx');
    expect(nodeMap).not.toBeNull();
    expect(nodeMap?.length).toBe(1);
  });

  it('should clear node map on invalidate', () => {
    transport.simulateMessage({
      type: 'node-map-update',
      filePath: 'src/App.tsx',
      fileHash: 'abc',
      version: 1,
      nodes: [],
    });
    transport.simulateMessage({ type: 'node-map-invalidate', filePath: 'src/App.tsx' });
    expect(tracer.getNodeMap('src/App.tsx')).toBeNull();
  });

  it('should call selection handlers on resolve-element-response', () => {
    const onSelect = mock(() => {});
    tracer.onSelectionResolved(onSelect);
    transport.simulateMessage({
      type: 'resolve-element-response',
      requestId: 'req-1',
      nodeRef: 'src/App.tsx:0',
      entry: {
        nodeRef: 'src/App.tsx:0',
        tag: 'div',
        loc: { fileName: 'src/App.tsx', line: 5, column: 4 },
        endLoc: { fileName: 'src/App.tsx', line: 5, column: 30 },
        parentRef: null,
        children: [],
        isComponent: false,
        fingerprint: '0000',
      },
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('should dispose cleanly', () => {
    tracer.dispose();
  });

  it('should dispose the transport itself — a reconnecting transport must stop (HYP-594)', () => {
    const disposeFn = mock();
    const disposableTransport = { ...mockTransport(), dispose: disposeFn };
    const t = new ElementTracer(mockAdapter(), disposableTransport);

    t.dispose();

    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  describe('resolveClickLocal', () => {
    const cachedNode: NodeMapEntry = {
      nodeRef: '/app/src/App.tsx:0',
      tag: 'div',
      loc: { fileName: '/app/src/App.tsx', line: 5, column: 4 },
      endLoc: { fileName: '/app/src/App.tsx', line: 10, column: 10 },
      parentRef: null,
      children: [],
      isComponent: false,
      fingerprint: 'a1b2',
    };

    it('should resolve element from cached node map without server round-trip', () => {
      adapter = mockAdapter({
        getSourceLocation: () => ({ fileName: '/app/src/App.tsx', line: 5, column: 4 }),
        getItemIndex: () => 0,
      });
      transport = mockTransport();
      tracer = new ElementTracer(adapter, transport);

      transport.simulateMessage({
        type: 'node-map-update',
        filePath: '/app/src/App.tsx',
        fileHash: 'abc123',
        version: 1,
        nodes: [cachedNode],
      });

      const result = tracer.resolveClickLocal({} as HTMLElement);

      expect(result).not.toBeNull();
      expect(result?.nodeRef).toBe('/app/src/App.tsx:0');
      expect(result?.entry.tag).toBe('div');
      expect(result?.source.line).toBe(5);
      expect(result?.itemIndex).toBe(0);
      expect(transport.sent).toHaveLength(0);
    });

    it('should fall back to server resolution when no cached map matches', () => {
      adapter = mockAdapter({
        getSourceLocation: () => ({ fileName: '/app/src/Unknown.tsx', line: 1, column: 0 }),
        getItemIndex: () => 0,
      });
      transport = mockTransport();
      tracer = new ElementTracer(adapter, transport);

      const result = tracer.resolveClickLocal({} as HTMLElement);

      expect(result).toBeNull();
      expect(transport.sent).toHaveLength(1);
      expect(transport.sent[0].type).toBe('resolve-element');
    });

    it('should return null when adapter returns no source', () => {
      adapter = mockAdapter({ getSourceLocation: () => null });
      transport = mockTransport();
      tracer = new ElementTracer(adapter, transport);

      const result = tracer.resolveClickLocal({} as HTMLElement);
      expect(result).toBeNull();
      expect(transport.sent).toHaveLength(0);
    });

    it('should resolve when fiber source is relative (React 19) but nodeMap stores container path', () => {
      // HYP-351: parseDebugStack on React 19 fibers yields relative paths (src/App.tsx)
      // while server populates nodeMap with /app/-prefixed paths. Local resolution
      // must still succeed without a server round-trip.
      adapter = mockAdapter({
        getSourceLocation: () => ({ fileName: 'src/App.tsx', line: 5, column: 4 }),
        getItemIndex: () => 0,
      });
      transport = mockTransport();
      tracer = new ElementTracer(adapter, transport);

      transport.simulateMessage({
        type: 'node-map-update',
        filePath: '/app/src/App.tsx',
        fileHash: 'abc123',
        version: 1,
        nodes: [cachedNode],
      });

      const result = tracer.resolveClickLocal({} as HTMLElement);

      expect(result).not.toBeNull();
      expect(result?.nodeRef).toBe('/app/src/App.tsx:0');
      expect(transport.sent).toHaveLength(0);
    });

    it('should fall back to server when node exists in map but location does not match', () => {
      adapter = mockAdapter({
        getSourceLocation: () => ({ fileName: '/app/src/App.tsx', line: 99, column: 0 }),
        getItemIndex: () => 0,
      });
      transport = mockTransport();
      tracer = new ElementTracer(adapter, transport);

      transport.simulateMessage({
        type: 'node-map-update',
        filePath: '/app/src/App.tsx',
        fileHash: 'abc123',
        version: 1,
        nodes: [cachedNode],
      });

      const result = tracer.resolveClickLocal({} as HTMLElement);
      expect(result).toBeNull();
      expect(transport.sent).toHaveLength(1);
    });

    it('resolves imported component internals to the clicked map item call site', () => {
      const callSiteSource: DebugSource = {
        fileName: '/app/src/components/TrendingSidebar.tsx',
        lineNumber: 53,
        columnNumber: 12,
      };
      const firstUserSuggestion = mockFiber({
        tag: 0,
        type: function UserSuggestion() {},
        _debugSource: callSiteSource,
      });
      const secondUserSuggestion = mockFiber({
        tag: 0,
        type: function UserSuggestion() {},
        _debugSource: callSiteSource,
      });
      const sidebar = mockFiber({
        tag: 0,
        type: function TrendingSidebar() {},
        child: firstUserSuggestion,
        _debugSource: {
          fileName: '/app/src/components/TrendingSidebar.tsx',
          lineNumber: 4,
          columnNumber: 1,
        },
      });
      firstUserSuggestion.return = sidebar;
      firstUserSuggestion.sibling = secondUserSuggestion;
      secondUserSuggestion.return = sidebar;

      const internalButton = mockFiber({
        tag: 5,
        type: 'button',
        return: secondUserSuggestion,
        _debugSource: {
          fileName: '/app/src/components/UserSuggestion.tsx',
          lineNumber: 39,
          columnNumber: 7,
        },
      });
      secondUserSuggestion.child = internalButton;

      adapter = mockAdapter({
        getSourceLocation: () => ({ fileName: '/app/src/components/UserSuggestion.tsx', line: 39, column: 6 }),
        getItemIndex: () => 0,
      });
      transport = mockTransport();
      tracer = new ElementTracer(adapter, transport);
      tracer.renderedFile = 'src/components/TrendingSidebar.tsx';
      transport.simulateMessage({
        type: 'node-map-update',
        filePath: '/app/src/components/TrendingSidebar.tsx',
        fileHash: 'abc123',
        version: 1,
        nodes: [
          {
            nodeRef: '/app/src/components/TrendingSidebar.tsx:53:11',
            tag: 'UserSuggestion',
            loc: { fileName: '/app/src/components/TrendingSidebar.tsx', line: 53, column: 11 },
            endLoc: { fileName: '/app/src/components/TrendingSidebar.tsx', line: 53, column: 50 },
            parentRef: null,
            children: [],
            isComponent: true,
            fingerprint: 'callsite',
          },
        ],
      });

      const result = tracer.resolveClickLocal(attachFiber({} as HTMLElement, internalButton));

      expect(result?.nodeRef).toBe('/app/src/components/TrendingSidebar.tsx:53:11');
      expect(result?.itemIndex).toBe(1);
      expect(result?.source).toEqual({
        fileName: '/app/src/components/TrendingSidebar.tsx',
        line: 53,
        column: 11,
      });
      expect(transport.sent).toHaveLength(0);
    });

    it('maps a React 19 _debugStack call-site ancestor through the source map, not its raw COMPILED line (HYP-970)', () => {
      // React 19 + Vite: the imported <Tweet> component fiber carries only `_debugStack`, whose
      // frame is the COMPILED position in the transformed module (Feed.tsx:65:84 — past the real
      // 51-line file's EOF). Committing that raw line makes the node-map lookup miss and the
      // element resolve to the wrong file. With the mapCallSiteSource mapper the call site is
      // resolved in ORIGINAL coords (Feed.tsx:30:8) and matches the server node map.
      const tweetStack = new Error();
      tweetStack.stack = 'Error\n    at http://localhost:5173/src/components/Feed.tsx:65:84';
      const tweetComponent = mockFiber({ tag: 0, type: function Tweet() {}, _debugStack: tweetStack });
      const internalDiv = mockFiber({
        tag: 5,
        type: 'div',
        return: tweetComponent,
        _debugSource: { fileName: '/app/src/components/Tweet.tsx', lineNumber: 20, columnNumber: 4 },
      });
      tweetComponent.child = internalDiv;

      adapter = mockAdapter({
        getSourceLocation: () => ({ fileName: '/app/src/components/Tweet.tsx', line: 20, column: 3 }),
        getItemIndex: () => 0,
      });
      transport = mockTransport();
      // MAPPED-only mapper: the <Tweet> component fiber → original Feed.tsx:30:8 (never 65:84).
      const mapCallSiteSource = (f: Fiber) =>
        f === tweetComponent ? { fileName: 'src/components/Feed.tsx', line: 30, column: 8 } : null;
      tracer = new ElementTracer(adapter, transport, mapCallSiteSource);
      tracer.renderedFile = 'src/App.tsx';
      transport.simulateMessage({
        type: 'node-map-update',
        filePath: 'src/components/Feed.tsx',
        fileHash: 'feed',
        version: 1,
        nodes: [
          {
            nodeRef: 'src/components/Feed.tsx:30:8',
            tag: 'Tweet',
            loc: { fileName: 'src/components/Feed.tsx', line: 30, column: 8 },
            endLoc: { fileName: 'src/components/Feed.tsx', line: 30, column: 40 },
            parentRef: null,
            children: [],
            isComponent: true,
            fingerprint: 'callsite',
          },
        ],
      });

      const result = tracer.resolveClickLocal(attachFiber({} as HTMLElement, internalDiv));

      // Resolves to the MAPPED call site (never the compiled Feed.tsx:65:83), no server fallback.
      expect(result?.nodeRef).toBe('src/components/Feed.tsx:30:8');
      expect(result?.source.line).not.toBe(65);
      expect(transport.sent).toHaveLength(0);
    });
  });

  describe('buildSourceKeyIndex', () => {
    // HYP-351/HYP-366: keys are always normalized to project-relative form.
    // Callers that look up by fiber source should either use resolveBySource
    // (which normalizes the query) or strip the prefix themselves.
    const entry: NodeMapEntry = {
      nodeRef: 'app-0',
      tag: 'div',
      loc: { fileName: '/app/src/App.tsx', line: 15, column: 11 },
      endLoc: { fileName: '/app/src/App.tsx', line: 15, column: 30 },
      parentRef: null,
      children: [],
      isComponent: false,
      fingerprint: 'abcd',
    };

    beforeEach(() => {
      transport.simulateMessage({
        type: 'node-map-update',
        filePath: '/app/src/App.tsx',
        fileHash: 'h',
        version: 1,
        nodes: [entry],
      });
    });

    it('emits keys in relative form regardless of stored prefix', () => {
      const index = tracer.buildSourceKeyIndex();
      expect(index.get('src/App.tsx:15:11')?.nodeRef).toBe('app-0');
      expect(index.has('/app/src/App.tsx:15:11')).toBe(false);
    });

    it('resolveBySource accepts either the relative or container-prefixed form', () => {
      expect(tracer.resolveBySource({ fileName: 'src/App.tsx', line: 15, column: 11 })?.nodeRef).toBe('app-0');
      expect(tracer.resolveBySource({ fileName: '/app/src/App.tsx', line: 15, column: 11 })?.nodeRef).toBe('app-0');
    });
  });

  describe('public adapter delegates', () => {
    it('getSourceLocation should delegate to adapter', () => {
      const source = { fileName: 'App.tsx', line: 10, column: 4 };
      adapter = mockAdapter({ getSourceLocation: () => source });
      transport = mockTransport();
      tracer = new ElementTracer(adapter, transport);

      const result = tracer.getSourceLocation({} as HTMLElement);
      expect(result).toEqual(source);
    });

    it('getItemIndex should delegate to adapter', () => {
      adapter = mockAdapter({ getItemIndex: () => 3 });
      transport = mockTransport();
      tracer = new ElementTracer(adapter, transport);

      const result = tracer.getItemIndex({} as HTMLElement);
      expect(result).toBe(3);
    });
  });
});

/**
 * Parity guard (HYP-970): the SaaS entry point must wire a REAL source-map mapper into
 * ElementTracer's call-site walk-up. ElementTracer's `_mapCallSiteSource` is optional and
 * defaults to raw `parseDebugStack` when omitted — under React 19 + Vite that commits a
 * COMPILED `_debugStack` line (past the source file's EOF) and every inspector style write
 * fails with "Element not found". The wiring lives inside a React `useEffect` in
 * `useElementTracer.ts` (not unit-testable without rendering an iframe), so this guards the
 * source directly: if a future refactor drops the 3rd `ElementTracer` arg — or swaps it for a
 * no-op — the regression is caught here instead of in production.
 */
describe('parity guard: useElementTracer wires a real source-map mapper (HYP-970)', () => {
  const hookSrc = readFileSync(join(import.meta.dir, '..', '..', 'hooks', 'useElementTracer.ts'), 'utf8');

  it('constructs a real ModuleSourceMapResolver (not a no-op mapper)', () => {
    expect(hookSrc).toMatch(/new\s+ModuleSourceMapResolver\s*\(/);
  });

  it('passes moduleSourceMapResolver.resolveFiberSource as ElementTracer call-site mapper', () => {
    // Bind the assertion to the ElementTracer(...) call itself: the mapper reference must appear
    // WITHIN the constructor arguments (up to the terminating `;`). Dropping the 3rd arg leaves
    // `new ElementTracer(adapter, transport);` — no resolveFiberSource inside → this fails.
    expect(hookSrc).toMatch(/new\s+ElementTracer\s*\([^;]*moduleSourceMapResolver\.resolveFiberSource\s*\(/);
  });
});
