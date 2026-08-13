/**
 * @file Direct unit tests for the public fiber-internals helpers introduced/touched by
 * HYP-424: `parseDebugStackFrames`, `recoverNonSyntheticSourceLocation`,
 * `isRenderedFilePath`, plus the `findNearestSourceLocation` `_debugOwner` fallback.
 *
 * These functions are pure and branch-heavy; they were previously covered only
 * transitively through `resolveCallSiteTarget`, so this exercises their edge cases head-on.
 */
import { describe, expect, it } from 'bun:test';
import {
  type Fiber,
  FiberTag,
  findNearestSourceLocation,
  getItemIndexFromFiber,
  isRenderedFilePath,
  isUnsymbolicatedReact19Fiber,
  parseDebugStackFrames,
  recoverNonSyntheticSourceLocation,
} from './fiber-internals';

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

function stackFiber(frames: string[], overrides: Partial<Fiber> = {}): Fiber {
  const err = new Error();
  err.stack = ['Error', ...frames.map((f) => `    at ${f}`)].join('\n');
  return mockFiber({ _debugStack: err, ...overrides } as Partial<Fiber>);
}

describe('isRenderedFilePath', () => {
  it('matches when either path is a suffix of the other', () => {
    expect(isRenderedFilePath('/app/src/components/ChatInputBar.tsx', 'src/components/ChatInputBar.tsx')).toBe(true);
    expect(isRenderedFilePath('ChatInputBar.tsx', 'src/components/ChatInputBar.tsx')).toBe(true);
    expect(isRenderedFilePath('src/components/ChatInputBar.tsx', 'src/components/Other.tsx')).toBe(false);
  });
});

describe('parseDebugStackFrames', () => {
  it('returns ALL non-internal frames in stack order (0-based columns)', () => {
    const err = new Error();
    err.stack = [
      'Error',
      '    at http://localhost:5173/node_modules/react/jsx-dev-runtime.js:1:1', // internal — dropped
      '    at http://localhost:5173/src/components/ChatInputBar.tsx:18:5',
      '    at http://localhost:5173/src/main.tsx:10:92',
    ].join('\n');
    expect(parseDebugStackFrames(err)).toEqual([
      { fileName: 'src/components/ChatInputBar.tsx', line: 18, column: 4 },
      { fileName: 'src/main.tsx', line: 10, column: 91 },
    ]);
  });

  it('returns [] for an empty/whitespace stack', () => {
    const e1 = new Error();
    e1.stack = undefined;
    expect(parseDebugStackFrames(e1)).toEqual([]);
    const e2 = new Error();
    e2.stack = 'Error\n   \n  ';
    expect(parseDebugStackFrames(e2)).toEqual([]);
  });

  it('returns [] when every frame is React/bundler-internal', () => {
    const err = new Error();
    err.stack = [
      'Error',
      '    at http://localhost:5173/node_modules/react-dom/client.js:5:5',
      '    at <anonymous>:1:1',
    ].join('\n');
    expect(parseDebugStackFrames(err)).toEqual([]);
  });

  it('drops the Vite dep pre-bundling cache frame (single-package: node_modules/.vite/deps/)', () => {
    const err = new Error();
    err.stack = [
      'Error: react-stack-top-frame',
      '    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:246:30)',
      '    at MyComponent (http://localhost:5173/src/MyComponent.tsx:12:5)',
    ].join('\n');
    expect(parseDebugStackFrames(err)).toEqual([{ fileName: 'src/MyComponent.tsx', line: 12, column: 4 }]);
  });

  it('drops the Vite dep cache frame even with a monorepo sub-project segment inserted (HYP-897)', () => {
    // Vite's default cacheDir for a monorepo workspace sub-project is
    // `node_modules/.vite/<subProjectName>/deps/`, not the single-package
    // `node_modules/.vite/deps/` — a fixed literal substring match misses this
    // shape, so jsxDEV's own internal frame (always first) was wrongly kept as
    // the "source", collapsing every element in the app onto that one bogus
    // internal location (conloca-app, live-reproduced).
    const err = new Error();
    err.stack = [
      'Error: react-stack-top-frame',
      '    at exports.jsxDEV (http://localhost:55513/@fs/Users/ultra/work/conloca-private/node_modules/.vite/targets/conloca-app/deps/react_jsx-dev-runtime.js?v=bec84ed6:246:30)',
      '    at HostRoutePage (http://localhost:55513/src/app/ui/HostRoutePage.tsx:17:26)',
      '    at Object.react_stack_bottom_frame (http://localhost:55513/@fs/Users/ultra/work/conloca-private/node_modules/.vite/targets/conloca-app/deps/react-dom_client.js?v=bec84ed6:18509:20)',
    ].join('\n');
    expect(parseDebugStackFrames(err)).toEqual([{ fileName: 'src/app/ui/HostRoutePage.tsx', line: 17, column: 25 }]);
  });
});

describe('recoverNonSyntheticSourceLocation', () => {
  it('returns null when renderedFile is null', () => {
    const f = stackFiber(['http://localhost:5173/src/components/ChatInputBar.tsx:18:5']);
    expect(recoverNonSyntheticSourceLocation(f, null)).toBeNull();
  });

  it('returns null for a null fiber', () => {
    expect(recoverNonSyntheticSourceLocation(null, 'src/components/ChatInputBar.tsx')).toBeNull();
  });

  it('finds the rendered file in an ANCESTOR _debugStack', () => {
    const ancestor = stackFiber(['http://localhost:5173/src/components/ChatInputBar.tsx:18:5'], { tag: 0 });
    const clicked = stackFiber(['http://localhost:5173/src/__canvas_preview__.tsx:969:31'], { return: ancestor });
    expect(recoverNonSyntheticSourceLocation(clicked, 'src/components/ChatInputBar.tsx')).toEqual({
      fileName: 'src/components/ChatInputBar.tsx',
      line: 18,
      column: 4,
    });
  });

  it('finds the rendered file in a DESCENDANT subtree (scaffold wrapper case)', () => {
    const child = stackFiber(['http://localhost:5173/src/components/ChatInputBar.tsx:18:5'], { tag: 0 });
    const scaffold = stackFiber(['http://localhost:5173/src/__canvas_preview__.tsx:969:31'], { child });
    child.return = scaffold;
    expect(recoverNonSyntheticSourceLocation(scaffold, 'src/components/ChatInputBar.tsx')).toEqual({
      fileName: 'src/components/ChatInputBar.tsx',
      line: 18,
      column: 4,
    });
  });

  it('returns null (no commit) when the rendered file is unreachable — only unrelated frames exist', () => {
    const ancestor = stackFiber(['http://localhost:5173/src/main.tsx:10:92'], { tag: 0 });
    const clicked = stackFiber(['http://localhost:5173/src/__canvas_preview__.tsx:969:31'], { return: ancestor });
    expect(recoverNonSyntheticSourceLocation(clicked, 'src/components/ChatInputBar.tsx')).toBeNull();
  });

  it('does not hang and returns null on a deep descendant chain past the BFS bound', () => {
    // Build a 400-node-deep child chain whose sources never match the rendered file.
    let head: Fiber | null = null;
    for (let i = 0; i < 400; i++) {
      const node = stackFiber([`http://localhost:5173/src/filler-${i}.tsx:1:1`], { child: head });
      head = node;
    }
    const root = stackFiber(['http://localhost:5173/src/__canvas_preview__.tsx:969:31'], { child: head });
    expect(recoverNonSyntheticSourceLocation(root, 'src/components/ChatInputBar.tsx')).toBeNull();
  });
});

describe('findNearestSourceLocation _debugOwner fallback', () => {
  it('resolves via the _debugOwner chain when the return chain has no source', () => {
    const owner = stackFiber(['http://localhost:5173/src/components/Owner.tsx:7:3'], { tag: 0 });
    // The clicked fiber's return chain is bare (no _debugStack/_debugSource), but its
    // logical owner carries the source (React 19 RSC-hydration shape).
    const clicked = mockFiber({ _debugStack: null, return: null, _debugOwner: owner });
    expect(findNearestSourceLocation(clicked)).toEqual({
      fileName: 'src/components/Owner.tsx',
      line: 7,
      column: 2,
    });
  });
});

describe('getItemIndexFromFiber — React 19 .map() of components', () => {
  const FEED_MAP_CALL_SITE = 'http://localhost:5173/src/components/Feed.tsx:57:8';

  // Build the real React-19 fiber shape for `tweets.map(t => <Tweet .../>)`:
  //   <main>                       host (the map container = compParent)
  //     <Tweet/> <Tweet/> <Tweet/> component fibers, ALL with the same call-site _debugStack
  //       <article>                host root each Tweet returns
  //         <div>                  host wrapper
  //           <div class="text">   deep host element the user clicks
  // Every host fiber carries its OWN `_debugStack` (React 19), which is exactly why the
  // old "nearest fiber with _debugStack" walk collapsed deep clicks to index 0.
  function buildMappedFeed(): { articles: Fiber[]; texts: Fiber[] } {
    const main = stackFiber(['http://localhost:5173/src/components/Feed.tsx:50:4'], { tag: 5, type: 'main' });
    const articles: Fiber[] = [];
    const texts: Fiber[] = [];
    let prev: Fiber | null = null;
    for (let i = 0; i < 3; i++) {
      const tweet = stackFiber([FEED_MAP_CALL_SITE], { tag: 0, return: main });
      const article = stackFiber(['http://localhost:5173/src/components/Tweet.tsx:48:6'], {
        tag: 5,
        type: 'article',
        return: tweet,
      });
      tweet.child = article;
      const wrapper = stackFiber(['http://localhost:5173/src/components/Tweet.tsx:60:8'], {
        tag: 5,
        type: 'div',
        return: article,
      });
      article.child = wrapper;
      const text = stackFiber(['http://localhost:5173/src/components/Tweet.tsx:77:10'], {
        tag: 5,
        type: 'div',
        return: wrapper,
      });
      wrapper.child = text;
      if (prev) prev.sibling = tweet;
      else main.child = tweet;
      prev = tweet;
      articles.push(article);
      texts.push(text);
    }
    return { articles, texts };
  }

  it('resolves a DEEP host element to the clicked instance index (regression: was always 0)', () => {
    const { texts } = buildMappedFeed();
    expect(getItemIndexFromFiber(texts[0])).toBe(0);
    expect(getItemIndexFromFiber(texts[1])).toBe(1);
    expect(getItemIndexFromFiber(texts[2])).toBe(2);
  });

  it('resolves the repeated component ROOT host element by index', () => {
    const { articles } = buildMappedFeed();
    expect(getItemIndexFromFiber(articles[0])).toBe(0);
    expect(getItemIndexFromFiber(articles[1])).toBe(1);
    expect(getItemIndexFromFiber(articles[2])).toBe(2);
  });

  it('returns 0 for a deep element in a NON-repeated (single) component instance', () => {
    const main = stackFiber(['http://localhost:5173/src/components/Page.tsx:10:4'], { tag: 5, type: 'main' });
    const only = stackFiber(['http://localhost:5173/src/components/Page.tsx:12:6'], { tag: 0, return: main });
    main.child = only;
    const text = stackFiber(['http://localhost:5173/src/components/Tweet.tsx:77:10'], { tag: 5, return: only });
    only.child = text;
    expect(getItemIndexFromFiber(text)).toBe(0);
  });

  // Regression guard: the index walk must CLIMB THROUGH IndeterminateComponent (2) and
  // LazyComponent (16) fibers to reach the repeated component level above them. Before the
  // fix, those tags were not in COMPONENT_FIBER_TAGS, so `isComponentFiber()` returned false
  // and the walk skipped them — an Indeterminate/Lazy wrapper would always produce index 0
  // even when the repeated component was a single parent level above.
  it('climbs through an IndeterminateComponent (tag=2) to find the repeated level', () => {
    const MAP_CALL_SITE = 'http://localhost:5173/src/Feed.tsx:20:8';
    const main = stackFiber(['http://localhost:5173/src/Feed.tsx:15:4'], { tag: FiberTag.HostComponent, type: 'main' });
    let prev: Fiber | null = null;
    const texts: Fiber[] = [];
    for (let i = 0; i < 3; i++) {
      // Indeterminate wrapper at the repeated level (tag=2, e.g. before React 18 resolves it)
      const indeterminate = stackFiber([MAP_CALL_SITE], {
        tag: FiberTag.IndeterminateComponent,
        return: main,
      });
      const text = stackFiber(['http://localhost:5173/src/Card.tsx:5:6'], {
        tag: FiberTag.HostComponent,
        type: 'span',
        return: indeterminate,
      });
      indeterminate.child = text;
      if (prev) prev.sibling = indeterminate;
      else main.child = indeterminate;
      prev = indeterminate;
      texts.push(text);
    }
    expect(getItemIndexFromFiber(texts[0])).toBe(0);
    expect(getItemIndexFromFiber(texts[1])).toBe(1);
    expect(getItemIndexFromFiber(texts[2])).toBe(2);
  });

  it('isUnsymbolicatedReact19Fiber: true for a React-19 (_debugStack-only) tree, false when any _debugSource exists — HYP-974', () => {
    // React 19: _debugStack only, no _debugSource anywhere → the nearest source is a compiled
    // parseDebugStack frame that must be symbolicated, never committed.
    const react19Parent = mockFiber({ _debugStack: { stack: 'Error\n    at App (http://x/src/App.tsx:99:21)' } as unknown as Error });
    const react19Leaf = mockFiber({ _debugStack: { stack: 'Error\n    at App (http://x/src/App.tsx:101:32)' } as unknown as Error, return: react19Parent });
    expect(isUnsymbolicatedReact19Fiber(react19Leaf)).toBe(true);

    // React 18: a _debugSource anywhere up-chain → real source, not suppressed.
    const react18Parent = mockFiber({ _debugSource: { fileName: 'src/App.tsx', lineNumber: 12, columnNumber: 7 } });
    const react18Leaf = mockFiber({ return: react18Parent });
    expect(isUnsymbolicatedReact19Fiber(react18Leaf)).toBe(false);

    // null fiber → false (nothing to suppress).
    expect(isUnsymbolicatedReact19Fiber(null)).toBe(false);
  });

  it('findNearestDebugSource / isUnsymbolicatedReact19Fiber do NOT crash when a fiber .return is undefined (React-19 root) — HYP-971/974', () => {
    // React 19 may set the root fiber's `.return` to `undefined` (not `null`). A no-_debugSource
    // React-19 tree is walked to the root every call, so an unguarded `while (current !== null)`
    // would dereference `undefined._debugSource` and throw. The `?? null` guard must terminate.
    const rootish = mockFiber({
      _debugStack: { stack: 'Error\n    at App (http://x/src/App.tsx:99:21)' } as unknown as Error,
      return: undefined as unknown as Fiber | null,
    });
    expect(() => isUnsymbolicatedReact19Fiber(rootish)).not.toThrow();
    expect(isUnsymbolicatedReact19Fiber(rootish)).toBe(true);
  });

  it('climbs through a LazyComponent (tag=16) to find the repeated level', () => {
    const MAP_CALL_SITE = 'http://localhost:5173/src/Feed.tsx:30:8';
    const main = stackFiber(['http://localhost:5173/src/Feed.tsx:25:4'], { tag: FiberTag.HostComponent, type: 'ul' });
    let prev: Fiber | null = null;
    const texts: Fiber[] = [];
    for (let i = 0; i < 3; i++) {
      // LazyComponent wrapper (tag=16, e.g. React.lazy(() => import('./Item')))
      const lazy = stackFiber([MAP_CALL_SITE], {
        tag: FiberTag.LazyComponent,
        return: main,
      });
      const text = stackFiber(['http://localhost:5173/src/Item.tsx:3:4'], {
        tag: FiberTag.HostComponent,
        type: 'li',
        return: lazy,
      });
      lazy.child = text;
      if (prev) prev.sibling = lazy;
      else main.child = lazy;
      prev = lazy;
      texts.push(text);
    }
    expect(getItemIndexFromFiber(texts[0])).toBe(0);
    expect(getItemIndexFromFiber(texts[1])).toBe(1);
    expect(getItemIndexFromFiber(texts[2])).toBe(2);
  });
});
