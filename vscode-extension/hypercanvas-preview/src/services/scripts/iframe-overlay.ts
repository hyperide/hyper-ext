/**
 * Overlay rect rendering and scheduling for the iframe interaction script.
 * Computes overlay rects, applies grace-cache replays, and posts them to the parent webview.
 */

import type { OverlayElementResolver } from '@shared/canvas-interaction/types';
import { computeOverlayRects } from '@shared/canvas-interaction/overlay-rects';
import type { SelectionGraceCacheState } from './selection-grace-cache';
import { applySelectionGraceCache } from './selection-grace-cache';

interface OverlayState {
  selectedIds: string[];
  hoveredId: string | null;
  hoveredItemIndex: number | null;
  selectedItemIndices: Record<string, number | null>;
  engineMode: string;
  // HYP-991 — post-edit-errored element id (or null); forwarded into computeOverlayRects so an
  // independent `error` rect is produced for it even when it is not selected/hovered.
  errorElementId: string | null;
}

export interface OverlayContext {
  state: OverlayState;
  pendingHydratedSelectedIds: string[];
  pendingHydratedItemIndices: Record<string, number | null>;
  iframeElementResolver: OverlayElementResolver;
  selectionGraceCache: SelectionGraceCacheState;
  gracePeriodMs: number;
  scheduleSelectionGraceRetry: () => void;
  persistGraceCache: () => void;
  onPrune?: (elementId: string, reason: 'deselected' | 'expired') => void;
  prevRectsJSON: string;
  setPrevRectsJSON: (v: string) => void;
  needsOverlayUpdate: boolean;
  setNeedsOverlayUpdate: (v: boolean) => void;
  overlayRafScheduled: boolean;
  setOverlayRafScheduled: (v: boolean) => void;
  scheduleOverlayLoopIfNeeded: () => void;
  logSelsurvOverlayPaint: (id: string | null, found: boolean, visible: boolean) => void;
  logSelsurvFindMiss: (id: string, itemIndex: number | null) => void;
}

export function sendOverlayRects(ctx: OverlayContext): void {
  ctx.setOverlayRafScheduled(false);

  if (!ctx.needsOverlayUpdate) {
    return;
  }
  ctx.setNeedsOverlayUpdate(false);

  const usingHydratedStandIn = ctx.state.selectedIds.length === 0 && ctx.pendingHydratedSelectedIds.length > 0;
  const effectiveSelectedIds = usingHydratedStandIn ? ctx.pendingHydratedSelectedIds : ctx.state.selectedIds;
  const effectiveSelectedItemIndices = usingHydratedStandIn
    ? ctx.pendingHydratedItemIndices
    : ctx.state.selectedItemIndices;

  const result = computeOverlayRects(
    {
      selectedIds: effectiveSelectedIds,
      hoveredId: ctx.state.hoveredId,
      hoveredItemIndex: ctx.state.hoveredItemIndex,
      selectedItemIndices: effectiveSelectedItemIndices,
      engineMode: ctx.state.engineMode,
      errorElementId: ctx.state.errorElementId,
    },
    ctx.iframeElementResolver,
  );

  const graced = applySelectionGraceCache({
    selectedIds: effectiveSelectedIds,
    computedRects: result.overlayRects,
    cache: ctx.selectionGraceCache,
    now: performance.now(),
    gracePeriodMs: ctx.gracePeriodMs,
    onPrune: ctx.onPrune,
    selectedItemIndices: effectiveSelectedItemIndices,
  });
  result.overlayRects = graced.rects;
  if (graced.inGracePeriod) {
    ctx.scheduleSelectionGraceRetry();
  }
  ctx.persistGraceCache();

  const rects = result.overlayRects.map((r) => ({
    key: r.key,
    ...(r.elementId && { elementId: r.elementId }),
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    type: r.type,
    ...(r.resizable && { resizable: r.resizable }),
  }));

  {
    const sel0 = effectiveSelectedIds[0] ?? null;
    if (sel0 !== null) {
      const itemIdx = effectiveSelectedItemIndices[sel0] ?? null;
      const elements = ctx.iframeElementResolver.findElements(sel0, itemIdx);
      const domElementFound = elements.length > 0;
      const selectionRect = result.overlayRects.find((r) => r.type === 'selection' && r.elementId === sel0);
      const rectVisible = !!selectionRect && selectionRect.width > 0 && selectionRect.height > 0;
      ctx.logSelsurvOverlayPaint(sel0, domElementFound, rectVisible);
      if (!domElementFound) {
        ctx.logSelsurvFindMiss(sel0, itemIdx);
      }
    } else {
      ctx.logSelsurvOverlayPaint(null, false, false);
    }
  }

  const { placeholderRects } = result;

  const payload = JSON.stringify({ rects, placeholderRects });
  if (payload !== ctx.prevRectsJSON) {
    ctx.setPrevRectsJSON(payload);
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage(
      { type: 'hypercanvas:overlayRects', rects, placeholderRects, scrollY: window.scrollY },
      '*',
    );
  }

  if (
    ctx.needsOverlayUpdate ||
    ctx.state.selectedIds.length > 0 ||
    ctx.state.hoveredId !== null ||
    placeholderRects.length > 0
  ) {
    ctx.scheduleOverlayLoopIfNeeded();
  }
}
