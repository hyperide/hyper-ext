/**
 * @file Shared React fiber types, constants, and low-level traversal utilities
 *
 * Accessed via: iframe-interaction.ts (VS Code extension IIFE) and client/lib/element-tracing/fiber-utils.ts
 * Assumptions: React dev mode with __reactFiber$ on DOM nodes and _debugSource on fibers.
 * These are React internals stable since React 16 but not part of public API.
 */

import { stripPreviewProxyPrefix } from './path-normalization';
import { isSyntheticPreviewPath } from './synthetic-preview';
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
  // React 19 leaves this `undefined` (not null) for root-level fibers — optional, not nullable-only.
  _debugOwner?: Fiber | null;
}

/* ─── Constants ──────────────────────────────────────────────────── */

export const FiberTag = {
  FunctionComponent: 0,
  ClassComponent: 1,
  // React 17 and earlier: a fiber whose type hasn't been determined yet
  // (React resolves it on first render to FunctionComponent or ClassComponent).
  // Must be treated as a component fiber so the index walk climbs through it.
  IndeterminateComponent: 2,
  HostRoot: 3,
  HostComponent: 5,
  HostText: 6,
  ForwardRef: 11,
  // React.lazy() wrapper — behaves like a component; its child fiber carries the
  // real component tag once resolved. The index walk must not stop at a Lazy node.
  LazyComponent: 16,
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
    // React 19 may set the root fiber's `.return` to `undefined` (not `null`). Normalise so the
    // `!== null` loop guard terminates instead of dereferencing `undefined._debugSource` — for a
    // React-19 tree with NO `_debugSource` anywhere this walks to the root every call
    // (`isUnsymbolicatedReact19Fiber`, HYP-974), so an unguarded `undefined` would crash there.
    current = (current.return as Fiber | null | undefined) ?? null;
  }
  return null;
}

/**
 * True when a fiber's nearest source can ONLY come from a raw React-19 `_debugStack`
 * frame — i.e. there is no React-18 `_debugSource` anywhere up its `.return` chain.
 *
 * `_debugSource` (React ≤18) and `_debugStack` (React 19) are set by the React RUNTIME at
 * fiber creation and are mutually exclusive per React version (see the field docs above), so
 * a whole fiber tree is uniformly one or the other — no `_debugSource` anywhere ⇒ React 19.
 * For such a fiber, `findNearestSourceLocation` returns a `parseDebugStack` result, which under
 * Vite/jsxDEV is the COMPILED position in the transformed module (a line often past the real
 * file's EOF), NOT an original source. That frame is only an INPUT to source-map symbolication
 * and must NEVER be committed as a source: when the source map is cold, callers suppress it and
 * defer to the warm-retry instead of committing an unresolvable position (HYP-974 — the leaf
 * seed on the click path AND the `getSourceLocation` fallback both route through here).
 */
export function isUnsymbolicatedReact19Fiber(fiber: Fiber | null): boolean {
  return fiber !== null && findNearestDebugSource(fiber) === null;
}

/* ─── Comparison ─────────────────────────────────────────────────── */

/**
 * Compares two raw _debugSource values for equality.
 * Both values are 1-based (raw from React fiber) — no conversion needed
 * because we're comparing like with like, not against Babel AST positions.
 */
function sameDebugSource(a: DebugSource, b: DebugSource): boolean {
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

// Vite's dep pre-bundling cache. In a single-package repo this is
// `node_modules/.vite/deps/`, but Vite's default `cacheDir` for a monorepo
// WORKSPACE/sub-project includes an extra path segment naming that
// sub-project — e.g. `node_modules/.vite/targets/conloca-app/deps/`. A fixed
// literal substring match missed that shape entirely, so `jsxDEV`'s own
// internal frame (always the first frame of a React 19 `_debugStack`) was
// never recognized as internal: `parseDebugStack` then returned THIS
// bundler-internal frame as the "source" for every single element in the
// app, collapsing the FiberSourceIndex onto one bogus location and making
// every Explorer-tree selection miss (no selection overlay ever rendered) —
// HYP-897, live-reproduced against conloca-app's monorepo dev server.
const VITE_DEPS_CACHE_PATTERN = /node_modules[\\/]\.vite[\\/](?:[^\\/]+[\\/])*deps[\\/]/;

function isInternalUrl(url: string): boolean {
  // <anonymous> appears for eval'd code, unnamed scripts, and some SSR contexts
  if (url.startsWith('<')) return true;
  if (VITE_DEPS_CACHE_PATTERN.test(url)) return true;
  return REACT_INTERNAL_PATTERNS.some((p) => url.includes(p));
}

/** Parse one V8 Error.stack line into a SourceLocation, or null when it is not a
 *  source-bearing user frame (no match, or a React/bundler-internal URL). */
function parseStackLine(line: string): SourceLocation | null {
  // V8 format: "    at FuncName (URL:line:col)" or "    at URL:line:col"
  const m = line.match(/^\s+at\s+(?:[^(]+\s+\()?(.+):(\d+):(\d+)\)?$/);
  if (!m) return null;

  const url = m[1];
  if (isInternalUrl(url)) return null;

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

  // Strip the SaaS preview proxy prefix ("project-preview/{projectId}/src/…") —
  // it leaks into React 19 _debugStack module URLs, while node-map and AST
  // lookups expect project-relative paths.
  fileName = stripPreviewProxyPrefix(fileName);

  return {
    fileName,
    line: Number.parseInt(m[2], 10),
    column: Number.parseInt(m[3], 10) - 1, // V8 Error.stack is 1-based, SourceLocation.column is 0-based
  };
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
    const loc = parseStackLine(line);
    if (loc !== null) return loc;
  }
  return null;
}

/**
 * Parse ALL non-internal frames of a React 19 `_debugStack`, in stack order
 * (innermost JSX call site first). Unlike {@link parseDebugStack} (which returns
 * only the first), this exposes the deeper user frames — needed when the first
 * non-internal frame is a library module (e.g. a provider from `node_modules` that
 * the internal-frame filter does not strip) and the element's real component frame
 * sits further down the same stack (HYP-424).
 */
export function parseDebugStackFrames(err: Error): SourceLocation[] {
  const stack = err.stack;
  if (!stack) return [];
  const frames: SourceLocation[] = [];
  for (const line of stack.split('\n')) {
    const loc = parseStackLine(line);
    if (loc !== null) frames.push(loc);
  }
  return frames;
}

/** Fiber tags that represent a user/library COMPONENT instance (not a host DOM node). */
const COMPONENT_FIBER_TAGS = new Set<number>([
  FiberTag.FunctionComponent,
  FiberTag.ClassComponent,
  FiberTag.IndeterminateComponent,
  FiberTag.ForwardRef,
  FiberTag.MemoComponent,
  FiberTag.SimpleMemoComponent,
  FiberTag.LazyComponent,
]);

function isComponentFiber(fiber: Fiber): boolean {
  return COMPONENT_FIBER_TAGS.has(fiber.tag);
}

/**
 * Resolve a component fiber's JSX call site — where `<Comp/>` was written (e.g. the
 * `.map()` body in the parent). React 19 puts this in `_debugStack`; under RSC/Turbopack
 * `parseDebugStack` returns null (`.next/` paths) so the source-map `resolveLocation`
 * callback is the fallback.
 */
function readComponentCallSite(
  fiber: Fiber,
  resolveLocation?: (fiber: Fiber) => SourceLocation | null,
): SourceLocation | null {
  const fromStack = fiber._debugStack ? parseDebugStack(fiber._debugStack) : null;
  return fromStack ?? resolveLocation?.(fiber) ?? null;
}

/**
 * Index of `compFiber` among its same-call-site component siblings, or null when the call
 * site has only one instance (not a repeated `.map()` level) or can't be resolved.
 */
function componentSiblingIndex(
  compFiber: Fiber,
  resolveLocation?: (fiber: Fiber) => SourceLocation | null,
): number | null {
  const compLoc = readComponentCallSite(compFiber, resolveLocation);
  const compParent = compFiber.return;
  if (compLoc === null || compParent === null) return null;

  let matchCount = 0;
  let selfIndex = -1;
  let current: Fiber | null = compParent.child;
  while (current !== null) {
    if (isComponentFiber(current)) {
      const loc = readComponentCallSite(current, resolveLocation);
      if (loc && sameLocation(loc, compLoc)) {
        if (current === compFiber) selfIndex = matchCount;
        matchCount++;
      }
    }
    current = current.sibling;
  }
  return matchCount > 1 && selfIndex >= 0 ? selfIndex : null;
}

/**
 * React 19 item index for a deep host element inside a `.map()`ed COMPONENT.
 *
 * Why this is its own walk: React 19 sets `_debugStack` on EVERY host fiber, not just
 * components — so "walk up to the nearest fiber with `_debugStack`" stops at the clicked
 * element's immediate host parent and never reaches the repeated component, collapsing
 * every instance to index 0 (the map-item-click regression). Instead we walk up by component
 * TAG and, at the first ancestor component level whose call site has >1 sibling instances,
 * return this element's index within that group. Climbs past non-repeated component levels
 * so nested components still resolve to the outer repeated instance. Returns 0 when no
 * repeated component level exists.
 */
function getReact19ComponentInstanceIndex(
  start: Fiber,
  resolveLocation?: (fiber: Fiber) => SourceLocation | null,
): number {
  let compFiber: Fiber | null = start;
  while (compFiber !== null) {
    while (compFiber !== null && !isComponentFiber(compFiber)) {
      compFiber = compFiber.return;
    }
    if (compFiber === null) return 0;

    const indexAtLevel = componentSiblingIndex(compFiber, resolveLocation);
    if (indexAtLevel !== null) return indexAtLevel;

    // Not repeated at this component level — climb to the next component ancestor.
    compFiber = compFiber.return;
  }
  return 0;
}

/**
 * Count preceding instances rendered from the same JSX call site.
 * Supports React 18 (`_debugSource` on the fiber) and React 19 (`_debugStack` on the parent
 * component fiber). Handles `.map()` lists where multiple elements share the same call site.
 *
 * React 18: compares `_debugSource` among fiber siblings at the same level.
 * React 19: prefers the immediate DOM-sibling group (repeated host nodes); else walks up the
 * component-fiber chain to count repeated component instances (`getReact19ComponentInstanceIndex`).
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
  if (myLoc !== null && !isComponentFiber(parent)) {
    const hostIndex = getSiblingIndex(parent, myLoc);
    if (hostIndex > 0) return hostIndex;
  }

  // Fallback: the clicked host element's own DOM siblings do not repeat (it is a deep
  // element inside a `.map()`ed COMPONENT, e.g. <Tweet> rows). Count repeated component
  // instances by walking up the component-fiber chain. (HYP map-item-click regression.)
  return getReact19ComponentInstanceIndex(fiber, resolveLocation);
}

/**
 * Read the source location of a SINGLE fiber (no chain walk), supporting both
 * React 18 (`_debugSource`, incl. memo/forwardRef wrapper types) and React 19
 * (`_debugStack`). Returns null when this fiber carries no usable source.
 */
function readFiberSource(fiber: Fiber): SourceLocation | null {
  // React 18
  if (fiber._debugSource != null) {
    return debugSourceToLocation(fiber._debugSource);
  }
  // React 19
  if (fiber._debugStack) {
    const loc = parseDebugStack(fiber._debugStack);
    if (loc !== null) return loc;
  }
  // Wrapper types (React.memo / React.forwardRef)
  const fromType = extractDebugSourceFromType(fiber);
  if (fromType !== null) {
    return debugSourceToLocation(fromType);
  }
  return null;
}

/** Walk the `return` chain then the `_debugOwner` chain, returning the first
 *  fiber source `accept()` keeps. Shared by every nearest-source variant. */
function walkFiberSources(fiber: Fiber | null, accept: (loc: SourceLocation) => boolean): SourceLocation | null {
  // 1. Walk the structural parent chain (return) — covers most cases.
  let current: Fiber | null = fiber;
  while (current !== null) {
    const loc = readFiberSource(current);
    if (loc !== null && accept(loc)) return loc;
    current = current.return;
  }

  // 2. Walk the logical owner chain (_debugOwner) as a fallback.
  //    In React 19 RSC hydration, the owner component may have _debugStack
  //    pointing to a source path when the rendered element's return chain does not.
  //    Note: _debugOwner can be undefined (not null) in React 19 for root-level fibers.
  let owner: Fiber | null = fiber?._debugOwner ?? null;
  while (owner !== null) {
    const loc = readFiberSource(owner);
    if (loc !== null && accept(loc)) return loc;
    owner = owner._debugOwner ?? null;
  }

  return null;
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
  return walkFiberSources(fiber, () => true);
}

/** True when `fileName` is the rendered component file (either path is a suffix
 *  of the other — fiber paths and the rendered path can carry different prefixes).
 *  Shared so `resolveCallSiteTarget`'s "is this the rendered file?" check stays in
 *  one place. */
export function isRenderedFilePath(fileName: string, renderedFile: string): boolean {
  return fileName.endsWith(renderedFile) || renderedFile.endsWith(fileName);
}

/**
 * Collect ALL source candidates of a SINGLE fiber, in resolution order. Unlike
 * {@link readFiberSource} (first hit only), this exposes every `_debugStack` frame
 * so the recovery walk can reach the element's real component frame even when a
 * library frame precedes it in the same stack (HYP-424).
 */
function collectFiberSourceCandidates(fiber: Fiber): SourceLocation[] {
  // React 18: a single real source position.
  if (fiber._debugSource != null) return [debugSourceToLocation(fiber._debugSource)];
  // React 19: every non-internal frame of the JSX-call-site stack, innermost first.
  if (fiber._debugStack) {
    const frames = parseDebugStackFrames(fiber._debugStack);
    if (frames.length > 0) return frames;
  }
  // Wrapper types (React.memo / React.forwardRef).
  const fromType = extractDebugSourceFromType(fiber);
  return fromType !== null ? [debugSourceToLocation(fromType)] : [];
}

/** Walk the `return` chain then `_debugOwner` chain, scanning EVERY source
 *  candidate of each fiber, returning the first that `accept()` keeps. */
function walkFiberSourceCandidates(
  fiber: Fiber | null,
  accept: (loc: SourceLocation) => boolean,
): SourceLocation | null {
  let current: Fiber | null = fiber;
  while (current !== null) {
    for (const loc of collectFiberSourceCandidates(current)) {
      if (accept(loc)) return loc;
    }
    current = current.return;
  }
  let owner: Fiber | null = fiber?._debugOwner ?? null;
  while (owner !== null) {
    for (const loc of collectFiberSourceCandidates(owner)) {
      if (accept(loc)) return loc;
    }
    owner = owner._debugOwner ?? null;
  }
  return null;
}

/**
 * Bounded breadth-first search of a fiber's `child`/`sibling` subtree for the
 * first source `accept()` keeps. Used when the clicked element is the synthetic
 * preview wrapper's OWN scaffold container `<div style>` — the rendered user
 * component is then a DESCENDANT (the wrapper renders `<div>{<Component/>}</div>`),
 * not an ancestor, so the upward walk finds nothing and we must look down. (HYP-424)
 */
function findDescendantSource(
  fiber: Fiber | null,
  accept: (loc: SourceLocation) => boolean,
  // Bound guards against a pathological fiber tree; the scaffold wrapper's subtree to the
  // rendered component is typically well under 20 nodes, so 200 is comfortable headroom.
  maxNodes = 200,
): SourceLocation | null {
  const queue: Fiber[] = [];
  if (fiber?.child) queue.push(fiber.child);
  let scanned = 0;
  while (queue.length > 0 && scanned < maxNodes) {
    const node = queue.shift() as Fiber;
    scanned++;
    for (const loc of collectFiberSourceCandidates(node)) {
      if (accept(loc)) return loc;
    }
    if (node.child) queue.push(node.child);
    if (node.sibling) queue.push(node.sibling);
  }
  return null;
}

/**
 * Recover the element's REAL component source when its nearest fiber source is
 * the synthetic preview entry (`__canvas_preview__.tsx`) — HYP-424.
 *
 * Resolves the RENDERED component file (the user's actual component) from the
 * fiber tree. Other candidates are deliberately rejected as recovery targets:
 *  - Skipping merely the synthetic frame is not enough — the next resolvable fiber
 *    source is frequently a LIBRARY internal (e.g. a `react-native-safe-area-context`
 *    provider that `_debugStack` surfaces but the internal-frame filter doesn't strip).
 *  - Settling for the first non-synthetic USER frame is also wrong — for a Tamagui
 *    host node whose own JSX line is optimized out of the stack, that frame is an
 *    unrelated module boundary like the app entry (`src/main.tsx`), not the clicked
 *    element's component.
 *
 * Resolution order:
 *  1. ANCESTOR scan — for an element INSIDE the rendered component, its source is
 *     up the `return` chain (covers the common "clicked a div inside ChatInputBar").
 *  2. DESCENDANT scan — for the wrapper's OWN scaffold container `<div style>`, the
 *     rendered component is a CHILD (`<div>{<Component/>}</div>`), so look downward.
 *
 * Returns null when the rendered file is reachable in neither direction: the caller
 * keeps the synthetic direct source, which the click path routes into the
 * source-map warm-and-retry rather than committing an unrelated module.
 */
export function recoverNonSyntheticSourceLocation(
  fiber: Fiber | null,
  renderedFile: string | null,
): SourceLocation | null {
  if (!renderedFile) return null;
  const isRendered = (loc: SourceLocation): boolean =>
    !isSyntheticPreviewPath(loc.fileName) && isRenderedFilePath(loc.fileName, renderedFile);
  return walkFiberSourceCandidates(fiber, isRendered) ?? findDescendantSource(fiber, isRendered);
}
