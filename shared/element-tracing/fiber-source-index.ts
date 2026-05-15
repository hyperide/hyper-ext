/**
 * @file Shared FiberSourceIndex for reverse source-to-DOM lookups across SaaS and extension preview.
 *
 * Accessed via: client ReactAdapter + VS Code extension iframe interaction overlay lookup
 * Assumptions: React dev mode with fiber debug source metadata available on at least component or host fibers
 */

import { debugSourceToLocation, type Fiber, FiberTag, parseDebugStack } from './fiber-internals';
import type { SourceLocation } from './types';

type RootFiberProvider = () => Fiber | null;

export interface FiberSourceIndexOptions {
  resolveFiberSource?: (fiber: Fiber) => SourceLocation | null;
  mapSource?: (source: SourceLocation, fiber: Fiber) => SourceLocation;
}

function sourceKeyFromLocation(source: SourceLocation): string {
  return `${source.fileName}:${source.line}:${source.column}`;
}

function parseSourceKey(key: string): SourceLocation | null {
  const match = key.match(/^(.*):(\d+):(\d+)$/);
  if (!match) return null;
  return {
    fileName: match[1],
    line: Number.parseInt(match[2], 10),
    column: Number.parseInt(match[3], 10),
  };
}

function sameLocation(a: SourceLocation, b: SourceLocation): boolean {
  return a.fileName === b.fileName && a.line === b.line && a.column === b.column;
}

export function getOwnFiberSourceLocation(fiber: Fiber): SourceLocation | null {
  if (fiber._debugSource != null) {
    return debugSourceToLocation(fiber._debugSource);
  }
  if (fiber._debugStack) {
    return parseDebugStack(fiber._debugStack);
  }
  return null;
}

function walkFibers(root: Fiber, visitor: (fiber: Fiber) => void): void {
  const stack: Fiber[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    visitor(current);
    if (current.sibling !== null) stack.push(current.sibling);
    if (current.child !== null) stack.push(current.child);
  }
}

function findHostFiber(fiber: Fiber): Fiber | null {
  if (fiber.tag === FiberTag.HostComponent && fiber.stateNode !== null) {
    return fiber;
  }

  const stack: Fiber[] = [];
  if (fiber.child !== null) stack.push(fiber.child);

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;

    if (current.tag === FiberTag.HostComponent && current.stateNode !== null) {
      return current;
    }

    if (current.sibling !== null) stack.push(current.sibling);
    if (current.child !== null) stack.push(current.child);
  }

  return null;
}

export class FiberSourceIndex {
  private index: Map<string, HTMLElement[]> | null = null;
  private readonly rootProvider: RootFiberProvider;
  private readonly doc: Document;
  private readonly resolveFiberSource: (fiber: Fiber) => SourceLocation | null;
  private readonly mapSource: (source: SourceLocation, fiber: Fiber) => SourceLocation;

  constructor(rootProvider: RootFiberProvider, doc: Document, options: FiberSourceIndexOptions = {}) {
    this.rootProvider = rootProvider;
    this.doc = doc;
    this.resolveFiberSource = options.resolveFiberSource ?? getOwnFiberSourceLocation;
    this.mapSource = options.mapSource ?? ((source) => source);
  }

  invalidate(): void {
    this.index = null;
  }

  findDOMElement(source: SourceLocation, itemIndex: number): HTMLElement | null {
    const live = this.findDOMElements(source);
    return live[itemIndex] ?? null;
  }

  findDOMElements(source: SourceLocation): HTMLElement[] {
    this.ensureBuilt();
    if (this.index === null) return [];

    const matches = this.index.get(sourceKeyFromLocation(source));
    if (!matches) return [];
    return matches.filter((el) => this.doc.contains(el));
  }

  findClosestLineDOMElements(source: SourceLocation): HTMLElement[] {
    this.ensureBuilt();
    if (this.index === null) return [];

    let bestDistance = Number.POSITIVE_INFINITY;
    let best: HTMLElement[] = [];

    for (const [key, elements] of this.index) {
      const candidateSource = parseSourceKey(key);
      if (
        candidateSource === null ||
        candidateSource.fileName !== source.fileName ||
        candidateSource.line !== source.line
      ) {
        continue;
      }

      const live = elements.filter((el) => this.doc.contains(el));
      if (live.length === 0) continue;

      const distance = Math.abs(candidateSource.column - source.column);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = live;
      }
    }

    return best;
  }

  getLiveEntries(): Array<{ key: string; source: SourceLocation; elements: HTMLElement[] }> {
    this.ensureBuilt();
    if (this.index === null) return [];

    const entries: Array<{ key: string; source: SourceLocation; elements: HTMLElement[] }> = [];
    for (const [key, elements] of this.index) {
      const source = parseSourceKey(key);
      if (source === null) continue;

      const live = elements.filter((el) => this.doc.contains(el));
      if (live.length === 0) continue;

      entries.push({ key, source, elements: live });
    }
    return entries;
  }

  private ensureBuilt(): void {
    if (this.index !== null) return;

    const rootFiber = this.rootProvider();
    if (rootFiber === null) return;

    const newIndex = new Map<string, HTMLElement[]>();

    walkFibers(rootFiber, (fiber) => {
      const source = this.resolveFiberSource(fiber);
      if (source === null) return;

      const mappedSource = this.mapSource(source, fiber);
      if (this.shouldSkipNestedMappedSource(fiber, source, mappedSource)) return;

      const host = findHostFiber(fiber);
      if (host === null || host.stateNode === null || typeof host.stateNode !== 'object') return;

      const element = host.stateNode as HTMLElement;
      const key = sourceKeyFromLocation(mappedSource);
      const existing = newIndex.get(key);
      if (existing !== undefined) {
        existing.push(element);
      } else {
        newIndex.set(key, [element]);
      }
    });

    this.index = newIndex;
  }

  private shouldSkipNestedMappedSource(fiber: Fiber, source: SourceLocation, mappedSource: SourceLocation): boolean {
    if (sameLocation(source, mappedSource)) return false;

    let current = fiber.return;
    while (current !== null) {
      const ancestorSource = this.resolveFiberSource(current);
      if (ancestorSource !== null) {
        const ancestorMappedSource = this.mapSource(ancestorSource, current);
        if (sameLocation(ancestorMappedSource, mappedSource)) {
          return true;
        }
      }
      current = current.return;
    }

    return false;
  }
}

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
