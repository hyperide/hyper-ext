import { beforeEach, describe, expect, it } from 'bun:test';
import type { DebugSource, Fiber } from './fiber-utils';
import { ReactAdapter } from './react-adapter';

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

/** Attach a fake React fiber property to a plain object so getFiberFromDOM works. */
function withFiber(fiber: Fiber): HTMLElement {
  const el: Record<string, unknown> = {};
  // eslint-disable-next-line dot-notation -- key contains $ — cannot use dot notation
  el['__reactFiber$test'] = fiber;
  return el as unknown as HTMLElement;
}

function makeTrendingSidebarStack(): Error {
  return {
    stack:
      'Error\n' +
      '    at TrendingSidebar (/Users/ultra/work/ext-test-projects/react-vite-tw4-twitter/src/components/TrendingSidebar.tsx:20:3)',
  } as Error;
}

describe('ReactAdapter', () => {
  let adapter: ReactAdapter;

  beforeEach(() => {
    adapter = new ReactAdapter();
  });

  describe('getSourceLocation', () => {
    it('should extract source location from element with fiber', () => {
      // _debugSource.columnNumber is 1-based, SourceLocation.column is 0-based
      const source: DebugSource = { fileName: '/app/src/App.tsx', lineNumber: 5, columnNumber: 5 };
      const fiber = mockFiber({ _debugSource: source });
      const el = withFiber(fiber);

      const loc = adapter.getSourceLocation(el);
      expect(loc).not.toBeNull();
      expect(loc?.fileName).toBe('/app/src/App.tsx');
      expect(loc?.line).toBe(5);
      expect(loc?.column).toBe(4); // 5 - 1 = 4 (converted to 0-based)
    });

    it('should return null for element without fiber', () => {
      const el = {} as HTMLElement;
      expect(adapter.getSourceLocation(el)).toBeNull();
    });

    it('should handle missing columnNumber (default to 0)', () => {
      const source: DebugSource = { fileName: 'f.tsx', lineNumber: 10 };
      const fiber = mockFiber({ _debugSource: source });
      const el = withFiber(fiber);

      const loc = adapter.getSourceLocation(el);
      expect(loc?.column).toBe(0);
    });
  });

  describe('getComponentChain', () => {
    it('should return component ancestry', () => {
      const appSource: DebugSource = { fileName: 'index.tsx', lineNumber: 8, columnNumber: 2 };
      const appFiber = mockFiber({ tag: 0, type: function App() {}, _debugSource: appSource });
      const divFiber = mockFiber({
        tag: 5,
        return: appFiber,
        _debugSource: { fileName: 'App.tsx', lineNumber: 5, columnNumber: 4 },
      });
      appFiber.child = divFiber;

      const el = withFiber(divFiber);
      const chain = adapter.getComponentChain(el);

      const appInfo = chain.find((c) => c.name === 'App');
      expect(appInfo).toBeDefined();
      expect(appInfo?.source).not.toBeNull();
    });

    it('should return empty for element without fiber', () => {
      const el = {} as HTMLElement;
      expect(adapter.getComponentChain(el)).toEqual([]);
    });
  });

  describe('getItemIndex', () => {
    it('should return 0 for single element', () => {
      const fiber = mockFiber({ _debugSource: { fileName: 'f.tsx', lineNumber: 1, columnNumber: 0 } });
      const parentFiber = mockFiber({ child: fiber });
      fiber.return = parentFiber;

      const el = withFiber(fiber);
      expect(adapter.getItemIndex(el)).toBe(0);
    });

    it('should count siblings with same source location (.map() scenario)', () => {
      const source: DebugSource = { fileName: 'f.tsx', lineNumber: 10, columnNumber: 8 };
      const parentFiber = mockFiber();

      const li1 = mockFiber({ return: parentFiber, _debugSource: source, stateNode: {} as HTMLElement });
      const li2 = mockFiber({ return: parentFiber, _debugSource: source, stateNode: {} as HTMLElement });
      const li3 = mockFiber({ return: parentFiber, _debugSource: source, stateNode: {} as HTMLElement });

      parentFiber.child = li1;
      li1.sibling = li2;
      li2.sibling = li3;

      // Make li2.stateNode look like a React DOM element backed by li2
      const stateNodeRecord = li2.stateNode as Record<string, unknown>;
      // eslint-disable-next-line dot-notation -- key contains $ — cannot use dot notation
      stateNodeRecord['__reactFiber$test'] = li2;

      expect(adapter.getItemIndex(li2.stateNode as HTMLElement)).toBe(1);
    });

    it('should return the second TrendingSidebar map item in React 19', () => {
      const sidebarFiber = mockFiber({ tag: 0, _debugStack: makeTrendingSidebarStack() });
      const containerFiber = mockFiber({ tag: 5, return: sidebarFiber });
      const item1 = mockFiber({ tag: 5, return: containerFiber, stateNode: {} as HTMLElement });
      const item2 = mockFiber({ tag: 5, return: containerFiber, stateNode: {} as HTMLElement });
      containerFiber.child = item1;
      item1.sibling = item2;
      item1.return = containerFiber;
      item2.return = containerFiber;
      sidebarFiber.child = containerFiber;

      const el = withFiber(item2);
      expect(adapter.getItemIndex(el)).toBe(1);
    });
  });
});
