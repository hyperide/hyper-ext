import { describe, expect, it } from 'bun:test';
import {
  type DebugSource,
  type Fiber,
  findHostFiber,
  findNearestDebugSource,
  findNearestSourceLocation,
  getFiberFromDOM,
  getItemIndexFromFiber,
  isUserComponent,
  parseDebugStack,
  traceToRoot,
} from './fiber-utils';

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

function mockDebugSource(overrides: Partial<DebugSource> = {}): DebugSource {
  return {
    fileName: '/app/src/App.tsx',
    lineNumber: 10,
    columnNumber: 4,
    ...overrides,
  };
}

function mockErrorStack(fileName: string, line: number, column: number): Error {
  return {
    stack: `Error\n    at TrendingSidebar (${fileName}:${line}:${column})`,
  } as Error;
}

describe('getFiberFromDOM', () => {
  it('should extract fiber from __reactFiber$ property', () => {
    const fiber = mockFiber();
    const el = { __reactFiber$abc123: fiber } as unknown as HTMLElement;
    const result = getFiberFromDOM(el);
    expect(result).toBe(fiber);
  });

  it('should extract fiber from __reactInternalInstance$ (older React)', () => {
    const fiber = mockFiber();
    const el = { __reactInternalInstance$xyz: fiber } as unknown as HTMLElement;
    const result = getFiberFromDOM(el);
    expect(result).toBe(fiber);
  });

  it('should return null for non-React element', () => {
    const el = {} as HTMLElement;
    const result = getFiberFromDOM(el);
    expect(result).toBeNull();
  });
});

describe('findNearestDebugSource', () => {
  it('should return _debugSource from the fiber itself', () => {
    const source = mockDebugSource();
    const fiber = mockFiber({ _debugSource: source });
    expect(findNearestDebugSource(fiber)).toBe(source);
  });

  it('should walk up to find _debugSource on parent', () => {
    const source = mockDebugSource();
    const parent = mockFiber({ _debugSource: source });
    const child = mockFiber({ return: parent });
    expect(findNearestDebugSource(child)).toBe(source);
  });

  it('should return null if no fiber has _debugSource', () => {
    const parent = mockFiber();
    const child = mockFiber({ return: parent });
    expect(findNearestDebugSource(child)).toBeNull();
  });

  it('should unwrap React.memo wrapper (tag 14)', () => {
    const source = mockDebugSource();
    const wrappedType = { type: { _debugSource: source } };
    const memoFiber = mockFiber({ tag: 14, type: wrappedType as unknown });
    expect(findNearestDebugSource(memoFiber)).toBe(source);
  });

  it('should unwrap React.forwardRef wrapper (tag 11)', () => {
    const source = mockDebugSource();
    const wrappedType = { render: { _debugSource: source } };
    const forwardRefFiber = mockFiber({ tag: 11, type: wrappedType as unknown });
    expect(findNearestDebugSource(forwardRefFiber)).toBe(source);
  });
});

describe('traceToRoot', () => {
  it('should collect all fibers from target to root', () => {
    const root = mockFiber({ type: 'div' });
    const mid = mockFiber({ type: 'App', return: root });
    const leaf = mockFiber({ type: 'span', return: mid });
    const chain = traceToRoot(leaf);
    expect(chain.length).toBe(3);
    expect(chain[0]).toBe(leaf);
    expect(chain[2]).toBe(root);
  });

  it('should handle single fiber (root)', () => {
    const root = mockFiber();
    const chain = traceToRoot(root);
    expect(chain.length).toBe(1);
  });
});

describe('isUserComponent', () => {
  it('should return true for function component (tag 0)', () => {
    expect(isUserComponent(mockFiber({ tag: 0 }))).toBe(true);
  });

  it('should return true for class component (tag 1)', () => {
    expect(isUserComponent(mockFiber({ tag: 1 }))).toBe(true);
  });

  it('should return false for host component (tag 5)', () => {
    expect(isUserComponent(mockFiber({ tag: 5 }))).toBe(false);
  });

  it('should return false for host root (tag 3)', () => {
    expect(isUserComponent(mockFiber({ tag: 3 }))).toBe(false);
  });
});

describe('parseDebugStack', () => {
  it('returns source location from Vite-style stack frame', () => {
    const err = {
      stack: `Error\n    at App (http://localhost:5173/src/App.tsx:15:12)\n    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js:1234:56)`,
    } as Error;
    const result = parseDebugStack(err);
    expect(result).toEqual({ fileName: 'src/App.tsx', line: 15, column: 11 });
  });

  it('skips React internal frames', () => {
    const err = {
      stack: `Error\n    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react.js:1:1)\n    at App (http://localhost:5173/src/components/Button.tsx:8:5)`,
    } as Error;
    const result = parseDebugStack(err);
    expect(result).toEqual({ fileName: 'src/components/Button.tsx', line: 8, column: 4 });
  });

  it('returns null when all frames are React internal', () => {
    const err = { stack: `Error\n    at jsxDEV (http://localhost:5173/node_modules/react/index.js:1:1)` } as Error;
    expect(parseDebugStack(err)).toBeNull();
  });

  it('returns null for empty stack', () => {
    const err = { stack: '' } as Error;
    expect(parseDebugStack(err)).toBeNull();
  });

  it('handles frames without function name', () => {
    const err = { stack: `Error\n    at http://localhost:5173/src/App.tsx:5:3` } as Error;
    const result = parseDebugStack(err);
    expect(result).toEqual({ fileName: 'src/App.tsx', line: 5, column: 2 });
  });

  it('converts 1-based column to 0-based', () => {
    const err = { stack: `Error\n    at App (http://localhost:5173/src/App.tsx:1:1)` } as Error;
    const result = parseDebugStack(err);
    expect(result?.column).toBe(0);
  });

  // HYP-594: the SaaS platform serves the project dev server through the
  // /project-preview/<projectId>/ proxy — that prefix leaks into the module
  // URLs of React 19 _debugStack frames and must not reach lookups.
  it('strips the SaaS proxy prefix /project-preview/<projectId>/', () => {
    const err = {
      stack: `Error\n    at Hero (http://localhost:8080/project-preview/0a1b2c3d-4e5f-6789-abcd-ef0123456789/src/components/Hero.tsx:19:21)`,
    } as Error;
    const result = parseDebugStack(err);
    expect(result).toEqual({ fileName: 'src/components/Hero.tsx', line: 19, column: 20 });
  });

  it('strips the SaaS proxy prefix when the URL carries a Vite HMR query', () => {
    const err = {
      stack: `Error\n    at Hero (https://app.example.com/project-preview/deadbeef-0000-1111-2222-333344445555/src/App.tsx?t=1760000000000:5:9)`,
    } as Error;
    const result = parseDebugStack(err);
    expect(result).toEqual({ fileName: 'src/App.tsx', line: 5, column: 8 });
  });

  // Next.js (Turbopack/webpack) gives compiled chunk paths in the stack —
  // these are not source files and cannot be opened in the editor.
  it('returns null for Next.js Turbopack compiled chunk path', () => {
    const err = {
      stack: `Error\n    at App (_next/static/chunks/_01sjx_1._.js:1:234)\n    at renderWithHooks (_next/static/chunks/react-dom.js:1:500)`,
    } as Error;
    expect(parseDebugStack(err)).toBeNull();
  });

  it('returns null for Next.js server compiled chunk', () => {
    const err = {
      stack: `Error\n    at Page (_next/server/chunks/app_page.js:5:12)`,
    } as Error;
    expect(parseDebugStack(err)).toBeNull();
  });

  it('returns null for webpack-internal:// protocol', () => {
    const err = {
      stack: `Error\n    at App (webpack-internal:///./src/App.tsx:10:5)`,
    } as Error;
    expect(parseDebugStack(err)).toBeNull();
  });

  it('skips Next.js chunks and falls through to source frame if present', () => {
    // If somehow a source frame follows a compiled chunk frame, use the source frame
    const err = {
      stack: `Error\n    at App (_next/static/chunks/_01sjx_1._.js:1:234)\n    at Tweet (http://localhost:3000/src/Tweet.tsx:8:5)`,
    } as Error;
    const result = parseDebugStack(err);
    expect(result).toEqual({ fileName: 'src/Tweet.tsx', line: 8, column: 4 });
  });

  // Next.js Turbopack server-side chunks use "Server/file:///abs-path/.next/..." format
  it('returns null for Next.js Turbopack SSR chunk (Server/file:// format)', () => {
    const err = {
      stack: `Error\n    at Page (Server/file:///Users/dev/project/.next/dev/server/chunks/ssr/_0luh30o._.js:1:234)`,
    } as Error;
    expect(parseDebugStack(err)).toBeNull();
  });

  it('returns null for any .next/ build artifact (absolute path)', () => {
    const err = {
      stack: `Error\n    at App (file:///Users/dev/project/.next/static/chunks/main.js:10:5)`,
    } as Error;
    expect(parseDebugStack(err)).toBeNull();
  });

  // React 19.1+ wraps server component stacks with about://React/Server/ prefix
  it('returns null for React 19.1 about://React/Server/ RSC stack frame', () => {
    const err = {
      stack: `Error: react-stack-top-frame\n    at fakeJSXCallSite (http://localhost:3000/_next/static/chunks/react-server.js:1981:16)\n    at Home (about://React/Server/file:///Users/dev/project/.next/dev/server/chunks/ssr/page.js:41:268)`,
    } as Error;
    // Both frames should be filtered: first as _next/static/chunks, second as .next/
    expect(parseDebugStack(err)).toBeNull();
  });

  it('returns null for <anonymous> frame (eval or unnamed script)', () => {
    const err = {
      stack: `Error\n    at App (<anonymous>:10:5)`,
    } as Error;
    expect(parseDebugStack(err)).toBeNull();
  });

  it('skips <anonymous> and falls through to source frame if present', () => {
    const err = {
      stack: `Error\n    at App (<anonymous>:1:1)\n    at Page (http://localhost:3000/src/Page.tsx:5:3)`,
    } as Error;
    const result = parseDebugStack(err);
    expect(result).toEqual({ fileName: 'src/Page.tsx', line: 5, column: 2 });
  });
});

describe('findNearestSourceLocation', () => {
  it('returns source from React 18 _debugSource', () => {
    const source = mockDebugSource({ lineNumber: 10, columnNumber: 5 });
    const fiber = mockFiber({ _debugSource: source });
    expect(findNearestSourceLocation(fiber)).toEqual({ fileName: '/app/src/App.tsx', line: 10, column: 4 });
  });

  it('returns source from React 19 _debugStack', () => {
    const err = { stack: `Error\n    at App (http://localhost:5173/src/App.tsx:20:7)` } as Error;
    const fiber = mockFiber({ _debugStack: err });
    expect(findNearestSourceLocation(fiber)).toEqual({ fileName: 'src/App.tsx', line: 20, column: 6 });
  });

  it('prefers _debugSource over _debugStack (React 18 fiber)', () => {
    const source = mockDebugSource({ lineNumber: 10, columnNumber: 5 });
    const err = { stack: `Error\n    at App (http://localhost:5173/src/Other.tsx:20:7)` } as Error;
    const fiber = mockFiber({ _debugSource: source, _debugStack: err });
    const result = findNearestSourceLocation(fiber);
    expect(result?.fileName).toBe('/app/src/App.tsx');
  });

  it('walks up fiber tree for React 19', () => {
    const err = { stack: `Error\n    at App (http://localhost:5173/src/Parent.tsx:5:3)` } as Error;
    const parent = mockFiber({ _debugStack: err });
    const child = mockFiber({ return: parent });
    expect(findNearestSourceLocation(child)?.fileName).toBe('src/Parent.tsx');
  });

  it('returns null when no source info available', () => {
    const fiber = mockFiber();
    expect(findNearestSourceLocation(fiber)).toBeNull();
  });

  it('returns null for null fiber', () => {
    expect(findNearestSourceLocation(null)).toBeNull();
  });
});

describe('getItemIndexFromFiber', () => {
  // React 18: _debugSource on the fiber itself
  it('returns 0 for first React 18 sibling', () => {
    const source = mockDebugSource({ lineNumber: 5, columnNumber: 3 });
    const parent = mockFiber();
    const fiber1 = mockFiber({ _debugSource: source, return: parent });
    const fiber2 = mockFiber({ _debugSource: source, return: parent });
    parent.child = fiber1;
    fiber1.sibling = fiber2;
    expect(getItemIndexFromFiber(fiber1)).toBe(0);
  });

  it('returns 1 for second React 18 sibling', () => {
    const source = mockDebugSource({ lineNumber: 5, columnNumber: 3 });
    const parent = mockFiber();
    const fiber1 = mockFiber({ _debugSource: source, return: parent });
    const fiber2 = mockFiber({ _debugSource: source, return: parent });
    parent.child = fiber1;
    fiber1.sibling = fiber2;
    expect(getItemIndexFromFiber(fiber2)).toBe(1);
  });

  it('returns the ancestor map item index for a nested React 18 child', () => {
    const itemSource = mockDebugSource({ lineNumber: 10, columnNumber: 7 });
    const childSource = mockDebugSource({ lineNumber: 11, columnNumber: 9 });
    const list = mockFiber();
    const item1 = mockFiber({ _debugSource: itemSource, return: list });
    const item2 = mockFiber({ _debugSource: itemSource, return: list });
    const child1 = mockFiber({ _debugSource: childSource, return: item1 });
    const child2 = mockFiber({ _debugSource: childSource, return: item2 });

    list.child = item1;
    item1.sibling = item2;
    item1.child = child1;
    item2.child = child2;

    expect(getItemIndexFromFiber(child2)).toBe(1);
  });

  it('returns 0 for single-instance React 18 fiber', () => {
    const source = mockDebugSource();
    const parent = mockFiber();
    const fiber = mockFiber({ _debugSource: source, return: parent });
    parent.child = fiber;
    expect(getItemIndexFromFiber(fiber)).toBe(0);
  });

  // React 19: host fiber has no _debugSource; parent component fiber has _debugStack
  it('returns 0 for first React 19 component instance (host fiber input)', () => {
    const stack = `Error\n    at App (http://localhost:5173/src/List.tsx:10:5)`;
    const makeErr = (): Error => ({ stack }) as Error;

    const grandParent = mockFiber();
    const comp1 = mockFiber({ tag: 0, _debugStack: makeErr(), return: grandParent });
    const comp2 = mockFiber({ tag: 0, _debugStack: makeErr(), return: grandParent });
    grandParent.child = comp1;
    comp1.sibling = comp2;

    // Host fiber (tag=5, no _debugSource) under comp1
    const host1 = mockFiber({ tag: 5, return: comp1 });
    expect(getItemIndexFromFiber(host1)).toBe(0);
  });

  it('returns 1 for second React 19 component instance (host fiber input)', () => {
    const stack = `Error\n    at App (http://localhost:5173/src/List.tsx:10:5)`;
    const makeErr = (): Error => ({ stack }) as Error;

    const grandParent = mockFiber();
    const comp1 = mockFiber({ tag: 0, _debugStack: makeErr(), return: grandParent });
    const comp2 = mockFiber({ tag: 0, _debugStack: makeErr(), return: grandParent });
    grandParent.child = comp1;
    comp1.sibling = comp2;

    const host2 = mockFiber({ tag: 5, return: comp2 });
    expect(getItemIndexFromFiber(host2)).toBe(1);
  });

  it('returns 0 when no parent fiber (root)', () => {
    const fiber = mockFiber({ _debugSource: mockDebugSource() });
    expect(getItemIndexFromFiber(fiber)).toBe(0);
  });

  it('returns 0 for React 19 when all frames are internal', () => {
    const stack = `Error\n    at jsxDEV (http://localhost:5173/node_modules/react/index.js:1:1)`;
    const grandParent = mockFiber();
    const comp = mockFiber({ tag: 0, _debugStack: { stack } as Error, return: grandParent });
    grandParent.child = comp;
    const host = mockFiber({ tag: 5, return: comp });
    expect(getItemIndexFromFiber(host)).toBe(0);
  });

  it('distinguishes React 19 components on same line but different columns', () => {
    // Two components inlined on same line: `<A /> <B />` — same line, different columns
    const stack1 = `Error\n    at Foo (http://localhost:5173/src/Row.tsx:10:5)`;
    const stack2 = `Error\n    at Bar (http://localhost:5173/src/Row.tsx:10:20)`;
    const grandParent = mockFiber();
    const comp1 = mockFiber({ tag: 0, _debugStack: { stack: stack1 } as Error, return: grandParent });
    const comp2 = mockFiber({ tag: 0, _debugStack: { stack: stack2 } as Error, return: grandParent });
    grandParent.child = comp1;
    comp1.sibling = comp2;
    const host1 = mockFiber({ tag: 5, return: comp1 });
    const host2 = mockFiber({ tag: 5, return: comp2 });
    // Neither is a repeated instance — both are unique call sites
    expect(getItemIndexFromFiber(host1)).toBe(0);
    expect(getItemIndexFromFiber(host2)).toBe(0);
  });

  it('returns 1 for the second TrendingSidebar map item in React 19', () => {
    const fileName = '/Users/ultra/work/ext-test-projects/react-vite-tw4-twitter/src/components/TrendingSidebar.tsx';
    const trendingSidebar = mockFiber({
      tag: 0,
      _debugStack: mockErrorStack(fileName, 20, 3),
    });
    const container = mockFiber({ tag: 5, return: trendingSidebar });
    const first = mockFiber({ tag: 5, return: container, stateNode: {} as HTMLElement });
    const second = mockFiber({ tag: 5, return: container, stateNode: {} as HTMLElement });
    container.child = first;
    first.sibling = second;
    first.return = container;
    second.return = container;
    trendingSidebar.child = container;

    expect(getItemIndexFromFiber(second)).toBe(1);
  });

  it('returns 2 for the third TrendingSidebar map item in React 19', () => {
    const fileName = '/Users/ultra/work/ext-test-projects/react-vite-tw4-twitter/src/components/TrendingSidebar.tsx';
    const trendingSidebar = mockFiber({
      tag: 0,
      _debugStack: mockErrorStack(fileName, 20, 3),
    });
    const container = mockFiber({ tag: 5, return: trendingSidebar });
    const first = mockFiber({ tag: 5, return: container, stateNode: {} as HTMLElement });
    const second = mockFiber({ tag: 5, return: container, stateNode: {} as HTMLElement });
    const third = mockFiber({ tag: 5, return: container, stateNode: {} as HTMLElement });
    container.child = first;
    first.sibling = second;
    second.sibling = third;
    first.return = container;
    second.return = container;
    third.return = container;
    trendingSidebar.child = container;

    expect(getItemIndexFromFiber(third)).toBe(2);
  });

  it('keeps resolveLocation fallback when React 19 stack points at compiled output', () => {
    const compiledStack = mockErrorStack('/project/.next/static/chunks/app.js', 10, 1);
    const sourceLoc = {
      fileName: '/project/src/components/TrendingSidebar.tsx',
      line: 20,
      column: 3,
    };
    const parent = mockFiber({ tag: 5 });
    const firstComponent = mockFiber({ tag: 0, return: parent, _debugStack: compiledStack });
    const secondComponent = mockFiber({ tag: 0, return: parent, _debugStack: compiledStack });
    const firstHost = mockFiber({ tag: 5, return: firstComponent, stateNode: {} as HTMLElement });
    const secondHost = mockFiber({ tag: 5, return: secondComponent, stateNode: {} as HTMLElement });
    parent.child = firstComponent;
    firstComponent.sibling = secondComponent;
    firstComponent.child = firstHost;
    secondComponent.child = secondHost;

    expect(
      getItemIndexFromFiber(secondHost, (fiber) =>
        fiber === firstComponent || fiber === secondComponent ? sourceLoc : null,
      ),
    ).toBe(1);
  });
});

describe('findHostFiber', () => {
  it('should return same fiber if already a host component', () => {
    const fiber = mockFiber({ tag: 5, stateNode: {} as HTMLElement });
    expect(findHostFiber(fiber)).toBe(fiber);
  });

  it('should walk down to find first host child', () => {
    const hostChild = mockFiber({ tag: 5, stateNode: {} as HTMLElement });
    const component = mockFiber({ tag: 0, child: hostChild });
    expect(findHostFiber(component)).toBe(hostChild);
  });

  it('should return null if no host fiber found', () => {
    const component = mockFiber({ tag: 0 });
    expect(findHostFiber(component)).toBeNull();
  });
});
