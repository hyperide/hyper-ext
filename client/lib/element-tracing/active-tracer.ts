/**
 * @file Module-level singleton for the active ElementTracer instance.
 *
 * Accessed via: dom-utils.ts, CanvasElementContextMenu, and other client code
 * that needs fiber-based DOM element lookup but doesn't have direct tracer access.
 *
 * Set by useElementTracer hook when the tracer is created.
 * Transitional — callers should migrate to direct tracer injection.
 */

import type { ElementTracer } from './element-tracer';

let activeTracer: ElementTracer | null = null;
const subscribers = new Set<() => void>();

export function setActiveTracer(tracer: ElementTracer | null): void {
  activeTracer = tracer;
  for (const cb of subscribers) cb();
}

export function getActiveTracer(): ElementTracer | null {
  return activeTracer;
}

/** Subscribe to tracer changes. Returns an unsubscribe function. */
export function subscribeToTracer(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
