import type { SourceLocation } from '@shared/element-tracing/types';
import {
  type Fiber,
  findNearestSourceLocation,
  getFiberFromDOM,
  getItemIndexFromFiber,
} from '@shared/element-tracing/fiber-internals';
import { resolveOwnServerSourceMap, resolveViaClientSourceMap } from './iframe-source-maps';

/**
 * Direct fiber resolution — returns source only for Vite/Babel projects.
 * Returns null for Next.js RSC/Turbopack (all _debugStack frames filtered as .next/ internal).
 * DO NOT use directly for user-facing features — use iframeResolver.getSourceLocation()
 * or the full resolution chain (own-server → client → chain-server) instead.
 */
export function getSourceLocationFromDOM(el: HTMLElement): SourceLocation | null {
  const fiber = getFiberFromDOM(el);
  if (fiber === null) return null;
  return findNearestSourceLocation(fiber);
}

/**
 * Resolve source location for a fiber via source map caches.
 * Used as callback for getItemIndexFromFiber when parseDebugStack returns null (RSC/Turbopack).
 */
function resolveLocationViaSourceMaps(fiber: Fiber): SourceLocation | null {
  return resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber);
}

export function getItemIndexFromDOM(element: HTMLElement): number {
  const fiber = getFiberFromDOM(element);
  if (fiber === null) return 0;
  return getItemIndexFromFiber(fiber, resolveLocationViaSourceMaps);
}
