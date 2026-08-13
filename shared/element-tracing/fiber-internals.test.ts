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
  findNearestSourceLocation,
  isRenderedFilePath,
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
