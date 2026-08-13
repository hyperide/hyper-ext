/**
 * @file ReactAdapter — FrameworkAdapter implementation for React
 *
 * Accessed via: ElementTracer inside iframe preview
 * Assumptions: React dev mode. Supports React 18 (_debugSource on fibers) and
 * React 19 (_debugStack Error object on fibers). __reactFiber$ property exists
 * on all React-rendered DOM elements since React 16.
 */

import type {
  ComponentInfo,
  ComponentTreeNode,
  FrameworkAdapter,
  SourceLocation,
} from '../../../shared/element-tracing/types';
import { FiberSourceIndex } from './fiber-source-index';
import type { Fiber } from './fiber-utils';
import {
  FiberTag,
  findHostFiber,
  findNearestSourceLocation,
  getFiberDisplayName,
  getFiberFromDOM,
  getItemIndexFromFiber,
  isUserComponent,
  traceToRoot,
} from './fiber-utils';

export class ReactAdapter implements FrameworkAdapter {
  readonly name = 'react';
  private sourceIndex: FiberSourceIndex | null = null;
  private readonly doc: Document | null;
  private projectRoot: string | undefined;

  constructor(doc?: Document) {
    this.doc = doc ?? null;
  }

  setProjectRoot(projectRoot: string): void {
    this.projectRoot = projectRoot;
    this.sourceIndex?.setProjectRoot(projectRoot);
  }

  detect(doc: Document): boolean {
    // findReactRoot returns the element WITH __reactFiber$ (not the container)
    const root = this.findReactRoot(doc);
    if (root === null) return false;

    const record = root as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
        const fiber = record[key] as Fiber;
        const loc = findNearestSourceLocation(fiber);
        if (loc !== null && typeof loc.fileName === 'string' && typeof loc.line === 'number') {
          return true;
        }
      }
    }
    return false;
  }

  getSourceLocation(element: HTMLElement): SourceLocation | null {
    const fiber = getFiberFromDOM(element);
    if (fiber === null) return null;
    return findNearestSourceLocation(fiber);
  }

  getComponentChain(element: HTMLElement): ComponentInfo[] {
    const fiber = getFiberFromDOM(element);
    if (fiber === null) return [];

    const chain = traceToRoot(fiber);
    return chain.filter((f) => isUserComponent(f)).map((f) => this.fiberToComponentInfo(f));
  }

  getItemIndex(element: HTMLElement): number {
    const fiber = getFiberFromDOM(element);
    if (fiber === null) return 0;
    return getItemIndexFromFiber(fiber);
  }

  walkComponentTree(rootElement: HTMLElement): ComponentTreeNode[] {
    const fiber = getFiberFromDOM(rootElement);
    if (fiber === null) return [];
    return this.buildTreeFromFiber(fiber);
  }

  findDOMElement(source: SourceLocation, itemIndex: number): HTMLElement | null {
    return this.getSourceIndex().findDOMElement(source, itemIndex);
  }

  /** Returns the FiberSourceIndex, exposing invalidate() for the React commit hook. */
  getSourceIndex(): FiberSourceIndex {
    if (this.sourceIndex === null) {
      const doc = this.doc ?? document;
      this.sourceIndex = new FiberSourceIndex(() => this.findHostRootFiber(doc), doc, {
        projectRoot: this.projectRoot,
      });
    }
    return this.sourceIndex;
  }

  // ── Private helpers ──────────────────────────────────────────────

  /** Finds the React HostRoot fiber (tag 3) by walking up from the React root DOM element. */
  private findHostRootFiber(doc: Document): Fiber | null {
    const rootEl = this.findReactRoot(doc);
    if (rootEl === null) return null;

    const rootFiber = getFiberFromDOM(rootEl);
    if (rootFiber === null) return null;

    let current: Fiber | null = rootFiber;
    while (current !== null) {
      if (current.tag === FiberTag.HostRoot) {
        return current;
      }
      current = current.return;
    }

    return rootFiber;
  }

  private findReactRoot(doc: Document): HTMLElement | null {
    // NOTE: doc may be from an iframe. `instanceof HTMLElement` fails cross-realm
    // (iframe's HTMLElement !== parent window's HTMLElement). Use nodeType check instead.
    const candidates = ['#root', '#__next', '#app', '[data-reactroot]'];
    for (const selector of candidates) {
      const el = doc.querySelector(selector);
      if (el && el.nodeType === 1) {
        // React 18+ createRoot: container element has __reactContainer$ but NOT __reactFiber$.
        // __reactFiber$ lives on its first child. Return the child if container lacks fiber.
        const record = el as unknown as Record<string, unknown>;
        const hasFiber = Object.keys(record).some(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
        );
        if (hasFiber) return el as HTMLElement;
        // Check first child (React 18+ createRoot pattern)
        const firstChild = el.firstElementChild;
        if (firstChild && firstChild.nodeType === 1) {
          const childRecord = firstChild as unknown as Record<string, unknown>;
          const childHasFiber = Object.keys(childRecord).some((k) => k.startsWith('__reactFiber$'));
          if (childHasFiber) return firstChild as HTMLElement;
        }
        // Container found by selector but no fiber yet — return it anyway so detect() can retry
        return el as HTMLElement;
      }
    }
    // Check direct children of body
    if (doc.body !== null) {
      for (const child of Array.from(doc.body.children)) {
        if (child.nodeType === 1) {
          const record = child as unknown as Record<string, unknown>;
          for (const key of Object.keys(record)) {
            if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
              return child as HTMLElement;
            }
          }
        }
      }
    }
    return null;
  }

  private fiberToComponentInfo(fiber: Fiber): ComponentInfo {
    const name = getFiberDisplayName(fiber);
    const source = findNearestSourceLocation(fiber);

    const serializedProps: Record<string, string> = {};
    for (const [key, value] of Object.entries(fiber.memoizedProps)) {
      if (key === 'children') continue;
      try {
        serializedProps[key] = typeof value === 'string' ? value : JSON.stringify(value);
      } catch {
        serializedProps[key] = String(value);
      }
    }

    return {
      name,
      source,
      props: serializedProps,
      isLibrary: false,
    };
  }

  private buildTreeFromFiber(fiber: Fiber): ComponentTreeNode[] {
    const nodes: ComponentTreeNode[] = [];

    if (!isUserComponent(fiber)) {
      // For host fibers, recurse into children
      let child = fiber.child;
      while (child !== null) {
        nodes.push(...this.buildTreeFromFiber(child));
        child = child.sibling;
      }
      return nodes;
    }

    const source = findNearestSourceLocation(fiber);

    const host = findHostFiber(fiber);
    const domElement = host !== null && host.stateNode instanceof HTMLElement ? host.stateNode : null;

    const children: ComponentTreeNode[] = [];
    let child = fiber.child;
    while (child !== null) {
      children.push(...this.buildTreeFromFiber(child));
      child = child.sibling;
    }

    nodes.push({
      name: getFiberDisplayName(fiber),
      source,
      children,
      domElement,
      fiberTag: fiber.tag,
    });

    return nodes;
  }
}
