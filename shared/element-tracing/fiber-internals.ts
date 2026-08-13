/**
 * @file Shared React fiber types, constants, and low-level traversal utilities
 *
 * Accessed via: iframe-interaction.ts (VS Code extension IIFE) and client/lib/element-tracing/fiber-utils.ts
 * Assumptions: React dev mode with __reactFiber$ on DOM nodes and _debugSource on fibers.
 * These are React internals stable since React 16 but not part of public API.
 */

import type { SourceLocation } from './types';

/* ─── Types ──────────────────────────────────────────────────────── */

export interface DebugSource {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

export interface Fiber {
  tag: number;
  type: unknown;
  stateNode: unknown;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  memoizedProps: Record<string, unknown>;
  _debugSource?: DebugSource | null; // React 18; absent in React 19
  _debugStack?: Error | null; // React 19; absent in React 18
  _debugOwner: Fiber | null;
}

/* ─── Constants ──────────────────────────────────────────────────── */

export const FiberTag = {
  FunctionComponent: 0,
  ClassComponent: 1,
  HostRoot: 3,
  HostComponent: 5,
  HostText: 6,
  ForwardRef: 11,
  MemoComponent: 14,
  SimpleMemoComponent: 15,
} as const;

/* ─── DOM → Fiber ────────────────────────────────────────────────── */

/**
 * Extracts the React fiber from a DOM element via the internal property
 * React attaches (either __reactFiber$* or __reactInternalInstance$*).
 */
export function getFiberFromDOM(el: HTMLElement): Fiber | null {
  const record = el as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      return record[key] as Fiber;
    }
  }
  return null;
}

/* ─── Debug source resolution ────────────────────────────────────── */

/** Attempts to extract _debugSource from a fiber's type, unwrapping wrappers. */
function extractDebugSourceFromType(fiber: Fiber): DebugSource | null {
  const { tag, type } = fiber;

  if (tag === FiberTag.MemoComponent || tag === FiberTag.SimpleMemoComponent) {
    const wrapped = (type as { type?: { _debugSource?: DebugSource } }).type;
    return wrapped?._debugSource ?? null;
  }

  if (tag === FiberTag.ForwardRef) {
    const wrapped = (type as { render?: { _debugSource?: DebugSource } }).render;
    return wrapped?._debugSource ?? null;
  }

  return null;
}

/**
 * Walks up the fiber tree to find the nearest _debugSource.
 * Also checks wrapper types (React.memo, React.forwardRef).
 */
export function findNearestDebugSource(fiber: Fiber | null): DebugSource | null {
  let current: Fiber | null = fiber;
  while (current !== null) {
    if (current._debugSource != null) {
      return current._debugSource;
    }
    const fromType = extractDebugSourceFromType(current);
    if (fromType !== null) {
      return fromType;
    }
    current = current.return;
  }
  return null;
}

/* ─── Comparison ─────────────────────────────────────────────────── */

/**
 * Compares two raw _debugSource values for equality.
 * Both values are 1-based (raw from React fiber) — no conversion needed
 * because we're comparing like with like, not against Babel AST positions.
 */
export function sameDebugSource(a: DebugSource, b: DebugSource): boolean {
  return a.fileName === b.fileName && a.lineNumber === b.lineNumber && a.columnNumber === b.columnNumber;
}

/* ─── DebugSource → SourceLocation conversion ────────────────────── */

/**
 * Convert raw _debugSource to SourceLocation.
 * _debugSource.columnNumber is 1-based (Babel plugin output),
 * SourceLocation.column is 0-based (matches Babel AST node.loc.start.column).
 */
export function debugSourceToLocation(ds: DebugSource): SourceLocation {
  return {
    fileName: ds.fileName,
    line: ds.lineNumber,
    // _debugSource.columnNumber is 1-based, convert to 0-based
    column: (ds.columnNumber ?? 1) - 1,
  };
}

/**
 * Strip NodePod virtual FS prefix from a source file path.
 * NodePod mounts project files at /app inside its virtual FS, so fibers
 * produced by the Babel transform carry "/app/src/..." paths. Callers that
 * know they're in a NodePod context should apply this before storing the path.
 */
export function stripNodePodPrefix(fileName: string): string {
  return fileName.replace(/^\/app\//, '');
}

function sameLocation(a: SourceLocation, b: SourceLocation): boolean {
  return a.fileName === b.fileName && a.line === b.line && a.column === b.column;
}

function getReact18SiblingIndex(
  fiber: Fiber,
  source: DebugSource,
): { index: number; matchCount: number; found: boolean } {
  const parent = fiber.return;
  if (parent === null) return { index: 0, matchCount: 1, found: true };

  let index = 0;
  let matchCount = 0;
  let found = false;
  let current: Fiber | null = parent.child;
  while (current !== null) {
    const currentSource = current._debugSource ?? extractDebugSourceFromType(current);
    if (currentSource && sameDebugSource(currentSource, source)) {
      if (current === fiber) {
        found = true;
        index = matchCount;
      }
      matchCount++;
    }
    current = current.sibling;
  }

  return { index, matchCount, found };
}

/* ─── React 19: _debugStack parsing ─────────────────────────────── */

// Patterns identifying React-internal and bundler-internal stack frames.
// These appear before the actual user source in the Error.stack string.
const REACT_INTERNAL_PATTERNS = [
  'node_modules/react/',
  'node_modules\\react\\',
  'node_modules/react-dom/',
  'node_modules\\react-dom\\',
  'node_modules/scheduler/',
  'node_modules/.vite/deps/',
  'node_modules\\.vite\\deps\\',
  // Next.js URL paths (served via HTTP): compiled chunks — not source files
  '_next/static/chunks/',
  '_next/server/chunks/',
  '_next/server/app/',
  // Next.js absolute paths (.next/ build output directory)
  '/.next/',
  '\\.next\\',
  // webpack-internal: protocol (webpack module references, not source paths)
  'webpack-internal:',
];

function isInternalUrl(url: string): boolean {
  // <anonymous> appears for eval'd code, unnamed scripts, and some SSR contexts
  if (url.startsWith('<')) return true;
  return REACT_INTERNAL_PATTERNS.some((p) => url.includes(p));
}

/**
 * Parse a React 19 `_debugStack` Error object into a SourceLocation.
 *
 * React 19 removed `_debugSource` and instead captures a `new Error()` at the
 * JSX call site (`jsxDEV()`). The first non-React-internal frame is the source.
 *
 * V8 Error.stack columns are 1-based — converted to 0-based on return.
 * For Vite dev mode (ESM, per-file serving), stack URLs are full HTTP URLs;
 * the origin is stripped to get the workspace-relative path.
 */
export function parseDebugStack(err: Error): SourceLocation | null {
  const stack = err.stack;
  if (!stack) return null;

  for (const line of stack.split('\n')) {
    // V8 format: "    at FuncName (URL:line:col)" or "    at URL:line:col"
    const m = line.match(/^\s+at\s+(?:[^(]+\s+\()?(.+):(\d+):(\d+)\)?$/);
    if (!m) continue;

    const url = m[1];
    const lineNum = Number.parseInt(m[2], 10);
    const colNum = Number.parseInt(m[3], 10);

    if (isInternalUrl(url)) continue;

    // Strip protocol+host for absolute URLs (e.g. Vite dev server)
    let fileName = url;
    try {
      const parsed = new URL(url);
      // "http://localhost:5173/src/App.tsx" → "src/App.tsx"
      fileName = parsed.pathname.replace(/^\//, '');
    } catch {
      // Not an absolute URL — use as-is (relative path or file:// handled elsewhere)
    }

    // Strip NodePod virtual path prefix: "__virtual__/{podId}/{port}/src/..."
    // NodePod serves files via SW at /__virtual__/{randomId}/{vitePort}/...
    fileName = fileName.replace(/^__virtual__\/[^/]+\/\d+\//, '');

    return {
      fileName,
      line: lineNum,
      column: colNum - 1, // V8 Error.stack is 1-based, SourceLocation.column is 0-based
    };
  }

  return null;
}

/**
 * Count preceding instances rendered from the same JSX call site.
 * Supports React 18 (`_debugSource` on the fiber) and React 19 (`_debugStack` on the parent
 * component fiber). Handles `.map()` lists where multiple elements share the same call site.
 *
 * React 18: compares `_debugSource` among fiber siblings at the same level.
 * React 19: walks up to the nearest component fiber with `_debugStack`, then compares
 * parsed source locations among component-level siblings.
 */
export function getItemIndexFromFiber(fiber: Fiber, resolveLocation?: (fiber: Fiber) => SourceLocation | null): number {
  // React 18: _debugSource on the fiber directly
  if (fiber._debugSource != null) {
    let current: Fiber | null = fiber;
    while (current !== null) {
      const currentSource = current._debugSource ?? extractDebugSourceFromType(current);
      if (currentSource !== null) {
        const siblingIndex = getReact18SiblingIndex(current, currentSource);
        if (siblingIndex.found && siblingIndex.matchCount > 1) {
          return siblingIndex.index;
        }
      }
      current = current.return;
    }
    return 0;
  }

  // React 19: resolve the current fiber's effective source, then prefer the
  // immediate sibling group when it is a DOM-level repeated render (e.g. `.map()`).
  const parent = fiber.return;
  if (parent === null) return 0;
  const myLoc = findNearestSourceLocation(fiber) ?? resolveLocation?.(fiber) ?? null;

  const getSiblingIndex = (start: Fiber | null, targetLocation: SourceLocation): number => {
    if (start === null) return 0;
    let index = 0;
    let current: Fiber | null = start.child;
    while (current !== null) {
      const loc = findNearestSourceLocation(current) ?? resolveLocation?.(current) ?? null;
      if (loc && sameLocation(loc, targetLocation)) {
        if (current === fiber) return index;
        index++;
      }
      current = current.sibling;
    }
    return 0;
  };

  // When the immediate parent is not a component-like fiber, repeated items are
  // usually rendered as sibling host nodes inside the same container.
  if (
    myLoc !== null &&
    parent.tag !== FiberTag.FunctionComponent &&
    parent.tag !== FiberTag.ClassComponent &&
    parent.tag !== FiberTag.ForwardRef &&
    parent.tag !== FiberTag.MemoComponent &&
    parent.tag !== FiberTag.SimpleMemoComponent
  ) {
    const hostIndex = getSiblingIndex(parent, myLoc);
    if (hostIndex > 0) return hostIndex;
  }

  // Fallback: walk up to the nearest component fiber that has _debugStack and
  // compare component-level siblings. This handles repeated component instances.
  let compFiber: Fiber | null = parent;
  while (compFiber !== null && !compFiber._debugStack) {
    compFiber = compFiber.return;
  }
  if (compFiber === null || !compFiber._debugStack) return 0;

  // parseDebugStack returns null for RSC/Turbopack (_debugStack has .next/ paths).
  // Fall back to resolveLocation callback which uses source map caches.
  const compLoc = parseDebugStack(compFiber._debugStack) ?? resolveLocation?.(compFiber) ?? null;
  if (compLoc === null) return 0;

  const compParent = compFiber.return;
  if (compParent === null) return 0;

  let index = 0;
  let current: Fiber | null = compParent.child;
  while (current !== null) {
    if (current === compFiber) return index;
    if (current._debugStack) {
      const loc = parseDebugStack(current._debugStack) ?? resolveLocation?.(current) ?? null;
      if (loc && sameLocation(loc, compLoc)) {
        index++;
      }
    }
    current = current.sibling;
  }
  return 0;
}

/**
 * Find source location for a fiber, supporting both React 18 and React 19.
 *
 * React 18: reads `_debugSource` (set by Babel plugin).
 * React 19: parses `_debugStack` (Error object captured at JSX call site).
 *
 * Walk order:
 *  1. `return` chain (structural parent) — covers most cases.
 *  2. `_debugOwner` chain (logical owner) — fallback for RSC hydration where
 *     the rendered component's structural ancestor has no source but its
 *     logical owner (server component) does.
 */
export function findNearestSourceLocation(fiber: Fiber | null): SourceLocation | null {
  // 1. Walk the structural parent chain (return)
  let current: Fiber | null = fiber;
  while (current !== null) {
    // React 18
    if (current._debugSource != null) {
      return debugSourceToLocation(current._debugSource);
    }
    // React 19
    if (current._debugStack) {
      const loc = parseDebugStack(current._debugStack);
      if (loc !== null) return loc;
    }
    // Try wrapper types (React.memo / React.forwardRef)
    const fromType = extractDebugSourceFromType(current);
    if (fromType !== null) {
      return debugSourceToLocation(fromType);
    }
    current = current.return;
  }

  // 2. Walk the logical owner chain (_debugOwner) as a fallback.
  //    In React 19 RSC hydration, the owner component may have _debugStack
  //    pointing to a source path when the rendered element's return chain does not.
  //    Note: _debugOwner can be undefined (not null) in React 19 for root-level fibers.
  let owner: Fiber | null = (fiber?._debugOwner as Fiber | null | undefined) ?? null;
  while (owner !== null) {
    if (owner._debugSource != null) {
      return debugSourceToLocation(owner._debugSource);
    }
    if (owner._debugStack) {
      const loc = parseDebugStack(owner._debugStack);
      if (loc !== null) return loc;
    }
    owner = (owner._debugOwner as Fiber | null | undefined) ?? null;
  }

  return null;
}
