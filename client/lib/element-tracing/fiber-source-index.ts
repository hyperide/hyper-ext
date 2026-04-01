/**
 * @file FiberSourceIndex — lazy reverse index Map<sourceKey, HTMLElement[]>
 *
 * Accessed via: ReactAdapter.findDOMElement() inside iframe preview
 * Assumptions: React dev mode with _debugSource on fiber nodes.
 * Fiber tree is accessible from a root fiber provider (HostRoot, tag 3).
 *
 * Replaces O(N) full fiber tree walks with O(1) Map lookups.
 * Rebuilt lazily on first access after invalidation via React commit hook.
 *
 * Performance:
 * - Lookup: O(1) Map.get + O(K) filter for live elements
 * - Full rebuild: O(N), ~0.5-1ms for 8000 fibers
 * - Invalidation frequency: 1-5x per user interaction
 */

import type { SourceLocation } from '../../../shared/element-tracing/types';
import type { Fiber } from './fiber-utils';
import { findHostFiber, walkFibers } from './fiber-utils';

type RootFiberProvider = () => Fiber | null;

/**
 * Converts a _debugSource (1-based columnNumber) to a source key string
 * with 0-based column (matching SourceLocation convention).
 */
function sourceKeyFromDebugSource(fileName: string, lineNumber: number, columnNumber?: number): string {
  const column = columnNumber ? columnNumber - 1 : 0;
  return `${fileName}:${lineNumber}:${column}`;
}

/** Converts a SourceLocation (already 0-based column) to a source key string. */
function sourceKeyFromLocation(source: SourceLocation): string {
  return `${source.fileName}:${source.line}:${source.column}`;
}

export class FiberSourceIndex {
  private index: Map<string, HTMLElement[]> | null = null;
  private rootProvider: RootFiberProvider;
  private doc: Document;

  constructor(rootProvider: RootFiberProvider, doc: Document) {
    this.rootProvider = rootProvider;
    this.doc = doc;
  }

  /** Marks the index as stale. Next findDOMElement call triggers a rebuild. */
  invalidate(): void {
    this.index = null;
  }

  /**
   * O(1) lookup of a DOM element by source location and item index.
   * Filters out disconnected elements (Suspense unmounts, stale fibers).
   */
  findDOMElement(source: SourceLocation, itemIndex: number): HTMLElement | null {
    this.ensureBuilt();
    if (this.index === null) return null;

    const key = sourceKeyFromLocation(source);
    const matches = this.index.get(key);
    if (!matches) return null;

    const live = matches.filter((el) => this.doc.contains(el));
    return live[itemIndex] ?? null;
  }

  /** Lazily rebuilds the index by walking the full fiber tree. */
  private ensureBuilt(): void {
    if (this.index !== null) return;

    const rootFiber = this.rootProvider();
    if (rootFiber === null) return;

    const newIndex = new Map<string, HTMLElement[]>();

    walkFibers(rootFiber, (fiber) => {
      if (fiber._debugSource === null) return;

      const ds = fiber._debugSource;
      const key = sourceKeyFromDebugSource(ds.fileName, ds.lineNumber, ds.columnNumber);

      const host = findHostFiber(fiber);
      // findHostFiber guarantees tag=HostComponent + stateNode!==null,
      // so stateNode is always a DOM element. Duck-type check for testability.
      if (host === null || host.stateNode === null || typeof host.stateNode !== 'object') return;

      const el = host.stateNode as HTMLElement;
      const existing = newIndex.get(key);
      if (existing !== undefined) {
        existing.push(el);
      } else {
        newIndex.set(key, [el]);
      }
    });

    this.index = newIndex;
  }
}

/**
 * Hooks into __REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot to invalidate
 * the index on every React commit. Returns a cleanup function.
 */
export function hookIntoReactCommits(index: FiberSourceIndex, target: typeof globalThis = globalThis): () => void {
  const hook = (target as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ as
    | { onCommitFiberRoot?: (...args: unknown[]) => void }
    | undefined;

  if (!hook) return () => {};

  const original = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = (...args: unknown[]) => {
    index.invalidate();
    original?.(...args);
  };

  return () => {
    hook.onCommitFiberRoot = original;
  };
}
