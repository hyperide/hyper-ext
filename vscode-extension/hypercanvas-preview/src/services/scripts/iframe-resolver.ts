import { resolveCallSiteSource, resolveCallSiteTarget } from '@shared/canvas-interaction/resolve-source';
import type { LocalResolveResult, TracingResolver } from '@shared/canvas-interaction/types';
import { type Fiber, getFiberFromDOM, stripNodePodPrefix } from '@shared/element-tracing/fiber-internals';
import { FiberSourceIndex, getOwnFiberSourceLocation } from '@shared/element-tracing/fiber-source-index';
import type { SourceLocation } from '@shared/element-tracing/types';
import {
  clientInternalFrames,
  clientSourceMapCache,
  extractClientChunkFrames,
  hasUnresolvedServerFrames,
  resolveOwnServerSourceMap,
  resolveViaClientSourceMap,
  resolveViaServerSourceMap,
} from './iframe-source-maps';
import { getItemIndexFromDOM, getSourceLocationFromDOM } from './iframe-utils';
import { findHostRootFiber } from './react-dom-utils';

export interface ResolverContext {
  renderedComponentPath: string | null;
  pendingClickElement: HTMLElement | null;
  pendingClickTimestamp: { value: number };
  warmServerChunkFrames: (fiber: Fiber) => void;
  warmFiberChunkFrames: (fiber: Fiber) => void;
}

export function createIframeResolver(ctx: ResolverContext): TracingResolver {
  return {
    getSourceLocation(element: HTMLElement): SourceLocation | null {
      const fiber = getFiberFromDOM(element);
      let loc = getSourceLocationFromDOM(element);
      if (fiber) {
        const smLoc = resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber);
        if (smLoc) loc = smLoc;
      }
      if (loc) {
        return resolveCallSiteSource(loc, fiber, ctx.renderedComponentPath);
      }
      return loc;
    },

    getItemIndex(element: HTMLElement): number {
      const fiber = getFiberFromDOM(element);
      const directItemIndex = getItemIndexFromDOM(element);
      const source = getSourceLocationFromDOM(element);
      if (source === null) return directItemIndex;
      return resolveCallSiteTarget(source, fiber, ctx.renderedComponentPath, directItemIndex).itemIndex;
    },

    resolveClickLocal(element: HTMLElement): LocalResolveResult | null {
      ctx.pendingClickElement = null;
      let source = getSourceLocationFromDOM(element);
      const fiber = getFiberFromDOM(element);
      if (fiber !== null) {
        const smSource = resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber);
        if (smSource) {
          source = smSource;
        } else if (source === null) {
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
              ctx.pendingClickElement = element;
              ctx.pendingClickTimestamp.value = Date.now();
            }
          }
        }
      }
      if (source === null) return null;
      const directItemIndex = getItemIndexFromDOM(element);
      const target = resolveCallSiteTarget(source, fiber, ctx.renderedComponentPath, directItemIndex);
      source = target.source;
      const itemIndex = target.itemIndex;

      const syntheticRef = `${source.fileName}:${source.line}:${source.column}`;
      return {
        nodeRef: syntheticRef,
        entry: {
          nodeRef: syntheticRef,
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
    mapSource: (source, fiber) => resolveCallSiteSource(source, fiber, renderedComponentPath),
  });
  return sourceIndex;
}
