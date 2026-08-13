/**
 * @file Builds the two `resolveFiberSource` functions the SaaS canvas iframe injects — one for
 * the `ReactAdapter` leaf-seed commit path, one for `FiberSourceIndex` identity keys.
 *
 * Accessed via: useElementTracer (SaaS canvas iframe).
 * Assumptions: React dev mode; a `ModuleSourceMapResolver` warms/maps React-19 `_debugStack`
 *   module coords back to original source coords.
 *
 * Why two resolvers (HYP-974): a React-19 fiber with no `_debugSource` has only a `_debugStack`
 * frame, which under Vite/jsxDEV is the COMPILED position in the transformed module (often past
 * the real file's EOF) — an INPUT to source-map symbolication, NEVER a committable source. The two
 * consumers need OPPOSITE handling of a cold map, so they must NOT share one resolver:
 *
 *   • `forAdapter` — MAPPED-ONLY. `ReactAdapter.resolveSourceLocation` does `if (mapped) return
 *     mapped` BEFORE its `isUnsymbolicatedReact19Fiber` guard runs. If this folded
 *     `getOwnFiberSourceLocation`'s raw `parseDebugStack` compiled seed in, that truthy compiled
 *     value would be committed on a cold map and the guard would never fire — every inspector
 *     style write then fails with "Element not found" (the AST resolves no node at the compiled
 *     line). Returning null on a cold map lets the adapter's guard defer the click to the
 *     ClickRetryQueue warm-retry (and server resolve-element), which re-resolves the mapped
 *     original position once the module's source map lands.
 *   • `forSourceIndex` — FOLDED (mapped ?? own compiled). `FiberSourceIndex` has no internal
 *     `_debugSource` fallback, so it needs SOME value to key elements by identity; the compiled
 *     `_debugStack` position is a stable per-element identity (never committed as a source — the
 *     leaf-seed commit goes through `forAdapter`), and it is the ONLY source of a key for React-18
 *     `_debugSource` fibers on a cold map.
 *
 * This mirrors the extension's `iframe-resolver.ts`: its leaf-seed path keeps the source-map
 * resolver (`resolveOwnServerSourceMap ?? resolveViaClientSourceMap`) mapped-only and derives the
 * compiled `_debugStack` seed from a SEPARATE variable it drops when the map is cold, while its
 * `resolveSourceIndexFiberSource` folds `getOwnFiberSourceLocation` for index identity. Both
 * platforms now behave identically.
 */

import { getOwnFiberSourceLocation } from '@shared/element-tracing/fiber-source-index';
import type { SourceLocation } from '@shared/element-tracing/types';
import type { Fiber } from '@/lib/element-tracing/fiber-utils';

/** Minimal shape of `ModuleSourceMapResolver` this factory depends on (mapped-only lookup). */
export interface MappedFiberSourceResolver {
  resolveFiberSource(fiber: Fiber): SourceLocation | null;
}

export interface FiberSourceResolvers {
  /** Mapped-only — feeds `ReactAdapter`; a cold map returns null so the adapter guard defers. */
  forAdapter: (fiber: Fiber) => SourceLocation | null;
  /** Mapped, else the fiber's own (possibly compiled) position — feeds `FiberSourceIndex` keys. */
  forSourceIndex: (fiber: Fiber) => SourceLocation | null;
}

export function createFiberSourceResolvers(
  moduleSourceMapResolver: MappedFiberSourceResolver,
): FiberSourceResolvers {
  return {
    forAdapter: (fiber) => moduleSourceMapResolver.resolveFiberSource(fiber),
    forSourceIndex: (fiber) =>
      moduleSourceMapResolver.resolveFiberSource(fiber) ?? getOwnFiberSourceLocation(fiber),
  };
}
