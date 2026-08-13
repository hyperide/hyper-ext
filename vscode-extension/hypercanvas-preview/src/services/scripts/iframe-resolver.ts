import { resolveCallSiteSource, resolveCallSiteTarget } from '@shared/canvas-interaction/resolve-source';
import type { LocalResolveResult, TracingResolver } from '@shared/canvas-interaction/types';
import {
  debugSourceToLocation,
  type Fiber,
  findNearestDebugSource,
  getFiberFromDOM,
  isUnsymbolicatedReact19Fiber,
  stripNodePodPrefix,
} from '@shared/element-tracing/fiber-internals';
import { FiberSourceIndex, getOwnFiberSourceLocation } from '@shared/element-tracing/fiber-source-index';
import { isSyntheticPreviewPath } from '@shared/element-tracing/synthetic-preview';
import type { SourceLocation } from '@shared/element-tracing/types';
import {
  clientInternalFrames,
  clientSourceMapCache,
  extractClientChunkFrames,
  hasUnresolvedServerFrames,
  resolveOwnClientSourceMap,
  resolveOwnServerSourceMap,
  resolveViaClientSourceMap,
  resolveViaServerSourceMap,
} from './iframe-source-maps';
import { getItemIndexFromDOM, getSourceLocationFromDOM } from './iframe-utils';
import { findHostRootFiber } from './react-dom-utils';

export interface ResolverContext {
  renderedComponentPath: string | null;
  /**
   * BOXED pending-click ref (`{ current }`), shared by REFERENCE with the host's
   * `retryPendingClick`/`onEmptyClick`. Writing `ctx.pendingClickElement.current = el` here is
   * therefore visible to the warm-retry — a bare `HTMLElement | null` field was a by-value copy
   * whose write never reached the host, leaving the auto-retry dead (HYP-971). Mirrors
   * `pendingClickTimestamp`, which was already boxed for the same reason.
   */
  pendingClickElement: { current: HTMLElement | null };
  pendingClickTimestamp: { value: number };
  warmServerChunkFrames: (fiber: Fiber) => void;
  warmFiberChunkFrames: (fiber: Fiber) => void;
}

/**
 * OWN-fiber source-map mapper for the call-site walk-up. Resolves a fiber's own frame
 * ONLY (no `.return` walk — resolveViaClientSourceMap would bleed an unrelated ancestor's
 * source into the call site) and NEVER falls back to a raw `_debugStack`/`parseDebugStack`
 * frame. Passed into resolveCallSiteTarget/Source so the React-19 `_debugStack` ancestor
 * resolves to an ORIGINAL-source position (matching directSource), instead of the
 * transformed-module (jsxDEV) `parseDebugStack` line that lies past the real file's EOF and
 * that AstService can never resolve — every inspector style write then failed with "Element
 * not found" (HYP-970; same class HYP-49 already guards for the decorative drag path).
 * Returns null when the source map is still cold, so resolveCallSiteTarget keeps its own
 * `parseDebugStack` fallback / warm-retry rather than committing a compiled position.
 */
export function mapOwnFiberSource(fiber: Fiber): SourceLocation | null {
  return resolveOwnServerSourceMap(fiber) ?? resolveOwnClientSourceMap(fiber).resolved ?? null;
}

/** True when the fiber has an OWN client chunk frame whose source map is not yet fetched (cold),
 *  as opposed to a cached definitive miss. Own-fiber only — never walks `.return`. */
function hasUnresolvedOwnClientFrame(fiber: Fiber): boolean {
  if (!fiber._debugStack) return false;
  for (const frame of extractClientChunkFrames(fiber._debugStack)) {
    const key = `${frame.url}:${frame.line}:${frame.col}`;
    if (!clientSourceMapCache.has(key) && !clientInternalFrames.has(key)) return true;
  }
  return false;
}

/**
 * OWN-fiber call-site mapper that distinguishes the "no location" states `mapOwnFiberSource`
 * collapses to null (HYP-970 / Codex P1):
 *   - a mapped hit → return it.
 *   - a definitive mapped-MISS (client `resolved === null`, or all own frames cached) → return
 *     null WITHOUT flagging cold, so the caller keeps walking to the next mappable ancestor.
 *   - genuinely COLD (an own client OR server frame is not yet fetched) → kick off warming for
 *     THIS fiber's own frames (so it resolves to the TRUE call site next pass) and, when `cold`
 *     is provided, flag it so the caller keeps the valid leaf source instead of committing a
 *     wrong ancestor while the call-site map is still warming. Returns null for now.
 *
 * The cold flag is gated on an ACTUAL unresolved frame (not just `undefined`) so a server-only /
 * RSC call-site whose frame is a cached definitive-null is treated as a miss (skip), never as
 * cold-forever (Codex P1) — otherwise the walk would discard every later mappable ancestor.
 */
function mapOrWarmCallSite(
  fiber: Fiber,
  warmServer: (f: Fiber) => void,
  warmFiber: (f: Fiber) => void,
  cold?: { value: boolean },
): SourceLocation | null {
  const server = resolveOwnServerSourceMap(fiber);
  if (server) return server;
  const own = resolveOwnClientSourceMap(fiber);
  if (own.resolved !== undefined) return own.resolved; // mapped hit, or definitive client null-miss
  warmServer(fiber);
  warmFiber(fiber);
  if (cold && (hasUnresolvedOwnClientFrame(fiber) || hasUnresolvedServerFrames(fiber))) {
    cold.value = true;
  }
  return null;
}

/**
 * Resolve the call-site target while warming any COLD `_debugStack` ancestor and reporting
 * whether one was skipped. `coldCallSite === true` means a call-site ancestor's source map was
 * still warming and got skipped (warming for it was just kicked off) — the caller should keep the
 * element's own valid LEAF source for this pass rather than committing the further-up ancestor
 * the walk fell to, and the true call site resolves on the next pass once the frame warms. Used
 * by `resolveClickLocal` (HYP-970 / Codex P1). Side-effect: warms cold ancestors.
 */
function resolveCallSiteWithWarm(
  source: SourceLocation,
  fiber: Fiber | null,
  renderedComponentPath: string | null,
  directItemIndex: number,
  warmServer: (f: Fiber) => void,
  warmFiber: (f: Fiber) => void,
): { target: ReturnType<typeof resolveCallSiteTarget>; coldCallSite: boolean } {
  const cold = { value: false };
  const mapper = (f: Fiber): SourceLocation | null => mapOrWarmCallSite(f, warmServer, warmFiber, cold);
  const target = resolveCallSiteTarget(source, fiber, renderedComponentPath, directItemIndex, mapper);
  return { target, coldCallSite: cold.value };
}

export function createIframeResolver(ctx: ResolverContext): TracingResolver {
  // Call-site mapper for the read-only get* methods (getSourceLocation / getItemIndex /
  // getMappedSourceLocation): warm a cold ancestor so it resolves next pass. The cold flag is
  // not tracked here (no click to specialise). resolveClickLocal uses `resolveCallSiteWithWarm`
  // so it can keep the valid leaf source on the cold-call-site race.
  const mapFiberSource = (fiber: Fiber): SourceLocation | null =>
    mapOrWarmCallSite(fiber, ctx.warmServerChunkFrames, ctx.warmFiberChunkFrames);
  return {
    getSourceLocation(element: HTMLElement): SourceLocation | null {
      const fiber = getFiberFromDOM(element);
      let loc = getSourceLocationFromDOM(element);
      if (fiber) {
        const smLoc = resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber);
        if (smLoc) {
          loc = smLoc;
        } else if (loc && isUnsymbolicatedReact19Fiber(fiber)) {
          // `loc` is a RAW COMPILED React-19 `_debugStack` seed (getSourceLocationFromDOM →
          // parseDebugStack) and the source map is cold — committing it gives an unresolvable
          // nodeRef past the file's EOF. This is the click-handler FALLBACK path that would
          // otherwise defeat resolveClickLocal's defer (it re-derives the same compiled seed and
          // commits it via computeEffectiveRef). Suppress it → the fallback yields null → the click
          // defers to the warm-retry (resolveClickLocal already registered the pending click), which
          // re-resolves the mapped original position once the map lands. (HYP-974)
          loc = null;
        }
      }
      if (loc) {
        return resolveCallSiteSource(loc, fiber, ctx.renderedComponentPath, mapFiberSource);
      }
      return loc;
    },

    // Provenance-safe source resolution: returns a location ONLY when it comes
    // from a real source map hit (React 18 or 19) OR a React 18 `_debugSource`
    // (already a real source position). It deliberately NEVER falls back to a raw
    // React 19 `_debugStack` line, which under Vite dev is a *transformed-module*
    // position (past the on-disk EOF) and is useless for AST lookup. Used by the
    // decorative drag path, which must not commit a raw cold-cache line: when the
    // client source map is still cold, this returns null so the resolver fails safe
    // (no garbage write) instead of resolving to the transformed line. (HYP-49)
    getMappedSourceLocation(element: HTMLElement): SourceLocation | null {
      const fiber = getFiberFromDOM(element);
      if (fiber === null) return null;
      // OWN-fiber-only lookups (no `.return` walk). resolveViaClientSourceMap walks
      // ancestors when this fiber's own frame is cold, which for a decorative parent
      // would return an UNRELATED ancestor's source — the exact wrong-element rewrite
      // this path exists to avoid. So we resolve only the element's own frames and fail
      // safe (warm + null) when its own source map is cold. (HYP-49)
      const smLoc = resolveOwnServerSourceMap(fiber) ?? resolveOwnClientSourceMap(fiber).resolved ?? null;
      if (smLoc) return resolveCallSiteSource(smLoc, fiber, ctx.renderedComponentPath, mapFiberSource);
      // React 18: `_debugSource` (and memo/forwardRef wrapper types) is a real
      // source position; `findNearestDebugSource` reads only those, never `_debugStack`.
      const ds = findNearestDebugSource(fiber);
      if (ds) return resolveCallSiteSource(debugSourceToLocation(ds), fiber, ctx.renderedComponentPath, mapFiberSource);
      // No mapped source AND no React 18 `_debugSource` → React 19 with a cold source
      // map. Returning null makes the decorative drag fail safe, but if the map was never
      // warmed (initial prewarm missed/in-flight) the drag would be a silent no-op with
      // nothing fetching the map. Kick off warming (idempotent; same hooks the click path
      // and React-commit prewarm use) so a subsequent drag resolves once the map lands.
      ctx.warmServerChunkFrames(fiber);
      ctx.warmFiberChunkFrames(fiber);
      return null;
    },

    getItemIndex(element: HTMLElement): number {
      const fiber = getFiberFromDOM(element);
      const directItemIndex = getItemIndexFromDOM(element);
      const source = getSourceLocationFromDOM(element);
      if (source === null) return directItemIndex;
      return resolveCallSiteTarget(source, fiber, ctx.renderedComponentPath, directItemIndex, mapFiberSource).itemIndex;
    },

    warmElementSource(element: HTMLElement): void {
      // Kick off source-map warming for a drop-target element whose source is COLD
      // (React 19 / RSC, where chunk maps aren't yet fetched). Mirrors the cold branch
      // of resolveClickLocal but does NOT touch pendingClickElement (click-only state).
      //
      // Warming is ASYNC: warmServerChunkFrames posts a resolveServerSourceMap message
      // and warmFiberChunkFrames kicks off chunk fetches — neither populates the cache
      // synchronously, so the immediately-following getSourceLocation may still be cold.
      // The drag fires this on every pointermove and the AST write is deferred to drop
      // (pointerup), so by drop time the map for the hovered leaf is warm and the last
      // move's resolveDragSource resolves the LEAF (Step 1) instead of walking up to its
      // already-warm container (the #31 residual).
      const fiber = getFiberFromDOM(element);
      if (fiber === null) return;
      // OWN-fiber-only checks only. resolveViaClientSourceMap and getSourceLocationFromDOM
      // both walk the .return ancestor chain — they would find the CONTAINER's warm source
      // for a COLD LEAF and early-return, skipping the warm-up entirely (the exact scenario
      // this method exists to fix: HYP-31). Use own-fiber checks as in getMappedSourceLocation.
      if (resolveOwnServerSourceMap(fiber)) return; // own server source cached
      if (resolveOwnClientSourceMap(fiber).resolved !== undefined) return; // own client resolved or definitive miss
      ctx.warmServerChunkFrames(fiber);
      ctx.warmFiberChunkFrames(fiber);
    },

    resolveClickLocal(element: HTMLElement): LocalResolveResult | null {
      ctx.pendingClickElement.current = null;
      let source = getSourceLocationFromDOM(element);
      const fiber = getFiberFromDOM(element);
      // Warm the fiber's chunk frames and mark this click pending so the warm-retry
      // re-resolves it once the source maps land — shared by the cold-cache miss and the
      // still-synthetic guard below so the two retry paths can't drift.
      const deferToWarmRetry = (f: Fiber): void => {
        ctx.warmServerChunkFrames(f);
        ctx.warmFiberChunkFrames(f);
        ctx.pendingClickElement.current = element;
        ctx.pendingClickTimestamp.value = Date.now();
      };
      if (fiber !== null) {
        // React 19: getSourceLocationFromDOM (findNearestSourceLocation → parseDebugStack) hands
        // back the RAW COMPILED `_debugStack` frame — a position in the jsxDEV-transformed module
        // (e.g. src/App.tsx:101 for a host div written directly in the rendered 58-line App.tsx),
        // NOT an original source position. Only a React-18 `_debugSource` seed is already a real
        // source. `findNearestDebugSource(fiber) === null` means there is no `_debugSource` anywhere
        // up the tree → the DOM seed MUST have come from `parseDebugStack`, so it is a compiled
        // frame that AstService can never resolve (every inspector style write would fail with
        // "Element not found"). `resolveCallSiteTarget` cannot rescue it: compiled and original
        // share the SAME fileName (Vite transforms in-place), so `isFromRenderedFile` short-circuits
        // and returns the compiled seed verbatim — the HYP-970 cross-file mapper never sees it.
        // DevTools-faithful rule: a raw `_debugStack` frame is only an INPUT to source-map
        // symbolication; when unmapped, warm + defer (retryPendingClick re-resolves once the map
        // lands), never commit the compiled line (HYP-970 residual, react-vite-tw4-twitter).
        //
        // `isUnsymbolicatedReact19Fiber` (no `_debugSource` anywhere up-chain) reliably means
        // React 19 — `_debugSource`/`_debugStack` are runtime-uniform per React version, so this
        // can't misclassify a real React-18 seed (see the helper's doc in fiber-internals.ts). The
        // SAME predicate gates the `getSourceLocation` fallback so the two commit paths can't drift.
        //
        // Defer is TTL-bounded (`PENDING_CLICK_TTL_MS`): if the map genuinely never lands the
        // pending click expires (no infinite wait) and the click is a no-op — the intended
        // DevTools behavior for an unmappable frame (show nothing, never a bogus commit). For the
        // extension preview this is moot: Vite dev always serves inline source maps, so the frame
        // resolves on the warm-retry (verified: src/App.tsx:101:32 → the real App.tsx line).
        const domSeedIsCompiled = source !== null && isUnsymbolicatedReact19Fiber(fiber);
        const smSource = resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber);
        if (smSource) {
          source = smSource;
        } else if (source === null || domSeedIsCompiled) {
          // Drop the untrusted compiled seed so a still-cold map defers to the warm-retry
          // (below) rather than committing the compiled position.
          source = null;
          ctx.warmServerChunkFrames(fiber);
          source = resolveViaServerSourceMap(fiber);
          if (source === null) {
            ctx.warmFiberChunkFrames(fiber);
            const hasPending = (() => {
              let c: Fiber | null = fiber;
              while (c !== null) {
                if (c._debugStack) {
                  for (const frame of extractClientChunkFrames(c._debugStack)) {
                    const key = `${frame.url}:${frame.line}:${frame.col}`;
                    if (!clientSourceMapCache.has(key) && !clientInternalFrames.has(key)) return true;
                  }
                  break;
                }
                c = (c.return as Fiber | null | undefined) ?? null;
              }
              return hasUnresolvedServerFrames(fiber);
            })();
            if (hasPending) {
              ctx.pendingClickElement.current = element;
              ctx.pendingClickTimestamp.value = Date.now();
            }
          }
        }
      }
      if (source === null) return null;
      const directItemIndex = getItemIndexFromDOM(element);
      const { target, coldCallSite } = resolveCallSiteWithWarm(
        source,
        fiber,
        ctx.renderedComponentPath,
        directItemIndex,
        ctx.warmServerChunkFrames,
        ctx.warmFiberChunkFrames,
      );
      // Normally commit the resolved call-site target (e.g. the `<Tweet/>` usage in Feed). The
      // eager full-chain warm in `warmClientSourceMaps` makes the call-site frame warm before the
      // click, so this is the true call site for real (post-render) clicks.
      //
      // `coldCallSite` means a `_debugStack` call-site ancestor's source map was still cold and
      // was SKIPPED (warming for it was just kicked off). In that narrow race we must NOT commit
      // the further-up ancestor the walk fell to (a wrong container) — keep the element's own
      // LEAF source: a valid, AST-resolvable, and specific position (the element actually
      // clicked, matching 0.1.65). `resolveClickLocal` stays side-effect-free for hover reuse and
      // never returns a "deferred null" the shared click-handler would misread (HYP-970 / Codex
      // P1). Once the call-site frame warms, the next resolution pass yields the true call site.
      let itemIndex = directItemIndex;
      if (!coldCallSite) {
        source = target.source;
        itemIndex = target.itemIndex;
      }

      // Belt-and-suspenders: resolveCallSiteTarget already recovers the element's real
      // source when the direct source is the synthetic preview wrapper, but if the
      // rendered component is not yet reachable it keeps the synthetic line as a retry
      // sentinel. Committing __canvas_preview__.tsx as a nodeRef is never correct, so a
      // still-synthetic result defers to the warm-retry instead of selecting the wrapper.
      if (isSyntheticPreviewPath(source.fileName)) {
        if (fiber !== null) deferToWarmRetry(fiber);
        return null;
      }

      // After the guard above, `source` is guaranteed non-synthetic.
      const nodeRef = `${source.fileName}:${source.line}:${source.column}`;
      return {
        nodeRef,
        entry: {
          nodeRef,
          tag: '',
          loc: source,
          endLoc: source,
          parentRef: null,
          children: [],
          isComponent: false,
          fingerprint: '',
        },
        source,
        itemIndex,
      };
    },

    findDOMElement(): HTMLElement | null {
      return null;
    },
  };
}

let sourceIndex: FiberSourceIndex | null = null;

export function invalidateSourceCache(): void {
  sourceIndex?.invalidate();
}

export function resolveSourceIndexFiberSource(fiber: Fiber): SourceLocation | null {
  const loc = resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber) ?? getOwnFiberSourceLocation(fiber);
  if (loc === null) return null;
  return { ...loc, fileName: stripNodePodPrefix(loc.fileName) };
}

export function getSourceIndex(renderedComponentPath: string | null): FiberSourceIndex {
  if (sourceIndex) return sourceIndex;
  sourceIndex = new FiberSourceIndex(findHostRootFiber, document, {
    resolveFiberSource: resolveSourceIndexFiberSource,
    mapSource: (source, fiber) => resolveCallSiteSource(source, fiber, renderedComponentPath, mapOwnFiberSource),
  });
  return sourceIndex;
}
