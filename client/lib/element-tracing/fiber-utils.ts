/**
 * @file React fiber traversal utilities — client-only functions + re-exports from shared
 *
 * Accessed via: Internal module — consumed by ReactAdapter, FiberSourceIndex inside iframe
 * Assumptions: React dev mode with __reactFiber$ on DOM nodes and _debugSource on fibers.
 * These are React internals stable since React 16 but not part of public API.
 *
 * Shared types, constants, and core functions (DebugSource, Fiber, FiberTag,
 * getFiberFromDOM, findNearestDebugSource, findNearestSourceLocation, parseDebugStack,
 * sameDebugSource, debugSourceToLocation, getItemIndexFromFiber) live in shared/element-tracing/fiber-internals.ts
 * and are re-exported here so existing imports from './fiber-utils' continue to work.
 */

/* ─── Re-exports from shared ─────────────────────────────────────── */

export type { DebugSource, Fiber } from '../../../shared/element-tracing/fiber-internals';
export {
  FiberTag,
  findNearestDebugSource,
  findNearestSourceLocation,
  getFiberFromDOM,
  getItemIndexFromFiber,
  isUnsymbolicatedReact19Fiber,
  parseDebugStack,
} from '../../../shared/element-tracing/fiber-internals';

/* ─── Client-only imports ────────────────────────────────────────── */

import type { Fiber } from '../../../shared/element-tracing/fiber-internals';
import { FiberTag } from '../../../shared/element-tracing/fiber-internals';

/* ─── Tree traversal ─────────────────────────────────────────────── */

/** Collects all fibers from target up to the root (inclusive). */
export function traceToRoot(fiber: Fiber): Fiber[] {
  const chain: Fiber[] = [];
  let current: Fiber | null = fiber;
  while (current !== null) {
    chain.push(current);
    current = current.return;
  }
  return chain;
}

/** Returns true for function (tag 0) and class (tag 1) components. */
export function isUserComponent(fiber: Fiber): boolean {
  return fiber.tag === FiberTag.FunctionComponent || fiber.tag === FiberTag.ClassComponent;
}

/**
 * Walks down child/sibling links to find the first host fiber (tag 5)
 * that has a stateNode (i.e. a real DOM element).
 */
export function findHostFiber(fiber: Fiber): Fiber | null {
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

/* ─── DFS walk ───────────────────────────────────────────────────── */

/* ─── Display names ──────────────────────────────────────────────── */

/** Returns a human-readable name for a fiber's component type. */
export function getFiberDisplayName(fiber: Fiber): string {
  const { type } = fiber;

  if (typeof type === 'string') {
    return type;
  }

  if (typeof type === 'function') {
    return type.name || 'Anonymous';
  }

  if (type !== null && typeof type === 'object') {
    const obj = type as Record<string, unknown>;
    if (typeof obj.displayName === 'string') return obj.displayName;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.render === 'function') {
      return (
        (obj.render as { displayName?: string; name?: string }).displayName ??
        (obj.render as { name?: string }).name ??
        'ForwardRef'
      );
    }
    if (typeof (obj as { type?: unknown }).type === 'function') {
      const inner = (obj as { type: { displayName?: string; name?: string } }).type;
      return inner.displayName ?? inner.name ?? 'Memo';
    }
  }

  return 'Unknown';
}
