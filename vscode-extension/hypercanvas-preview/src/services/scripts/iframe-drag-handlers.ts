import { resolveDragSource } from '@shared/canvas-interaction/drag-source-resolver';
import { isHorizontalLayout as _isHorizontalLayoutShared } from '@shared/canvas-interaction/drop-indicator-orientation';
import { normalizeEventTarget } from '@shared/canvas-interaction/normalize-event-target';
import { resolveOrderWritePlan } from './iframe-drag-order';
import type { OrderWritePlan } from '@shared/canvas-interaction/order-drag-detect';
import type { TracingResolver } from '@shared/canvas-interaction/types';

export interface DragHandlerContext {
  state: { engineMode: string; selectedIds: string[] };
  iframeResolver: TracingResolver;
  renderedComponentPath: string | null;
  selectionGraceCache: { invalidateForFile(filePath: string): void };
  findElementsByRef: (ref: string, itemIndex: number | null) => HTMLElement[];
}

const DRAG_THRESHOLD_PX = 5;

function _isHorizontalLayout(el: HTMLElement): boolean {
  return _isHorizontalLayoutShared(el);
}

/**
 * Normalize a pointer event target to the Element that owns it (e2e #13).
 * Thin re-export of the shared helper so both the drag and click handlers share
 * one source of truth; kept exported under this name for the drag-handler tests.
 */
export const _normalizeEventTarget = normalizeEventTarget;

/**
 * Resolve the element under the cursor during a drag.
 *
 * Reading `e.target` is WRONG during an active drag: pointer capture
 * (`setPointerCapture` on pointerdown) redirects every `pointermove`/`pointerup`
 * to the captured source element, so `e.target` is always the dragged element and
 * a synthetic `document.dispatchEvent` reports `document`. Either way the drop
 * target can never resolve. `document.elementFromPoint(clientX, clientY)` does a
 * real hit-test at the cursor — independent of capture and synthetic dispatch —
 * and ignores `pointer-events:none` nodes, so the drag ghost/indicator/badge and
 * the (dimmed, `pointer-events:none`) source element are skipped automatically.
 *
 * Falls back to `_normalizeEventTarget(e.target)` when `elementFromPoint` is
 * unavailable or yields nothing (e.g. happy-dom under the unit-test runner, where
 * hit-testing isn't implemented), keeping the existing over-text coercion for it —
 * BUT never falls back to the captured source element. Under active pointer capture
 * `e.target` IS the dragged source; `elementFromPoint` returning null then usually
 * means the cursor left the iframe viewport (a normal drag-to-edge). Resolving the
 * captured source as the "drop target" there would either no-op (targetId===sourceId)
 * or, if the source's source-map resolved differently mid-drag, commit a wrong move.
 * Returning null instead leaves the last valid drop indicator in place and writes
 * nothing until the cursor is back over a real element.
 */
function _resolveDropTarget(e: PointerEvent): HTMLElement | null {
  const fromPoint =
    typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
      ? (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)
      : null;
  if (fromPoint) return _normalizeEventTarget(fromPoint);
  const fallback = _normalizeEventTarget(e.target);
  if (fallback && fallback === _dragSourceEl) return null;
  return fallback;
}

let _dragState: 'idle' | 'pending' | 'dragging' = 'idle';
let _dragSourceId: string | null = null;
let _dragSourceFilePath: string | null = null;
let _dragStartX = 0;
let _dragStartY = 0;
let _dragSuppressNextClick = false;
let _dragSourceEl: HTMLElement | null = null;
let _dragGhostEl: HTMLElement | null = null;
let _dragIndicatorEl: HTMLElement | null = null;
let _dragBadgeEl: HTMLElement | null = null;
let _dragOffsetX = 0;
let _dragOffsetY = 0;
let _dragCapturedPointerId: number | null = null;
let _dragCapturedTarget: HTMLElement | null = null;
let _dragPrevBodyUserSelect: string | null = null;
let _dragPrevBodyWebkitUserSelect: string | null = null;
let _dragEscapeHandler: ((e: KeyboardEvent) => void) | null = null;

/**
 * The AST write a drop will commit, recomputed on every `_dragPointerMove` so the
 * LAST hovered target wins. It is deliberately NOT posted during move: the parent
 * forwards `moveElement` fire-and-forget (unserialized) to `ast:moveElement`, which
 * rewrites the whole source file — posting per-move fires dozens of concurrent racing
 * file writes for one gesture (23 rewrites observed for a single drop). `_dragPointerUp`
 * fires EXACTLY ONE write from this snapshot; a move over no valid target clears it so
 * dropping there writes nothing; `_dragCleanup` (Escape/cancel) clears it without writing.
 */
type PendingDrop =
  | {
      kind: 'moveElement';
      sourceId: string;
      targetId: string;
      sourceFilePath: string;
      position: 'before' | 'after';
      /** Drop-target file, for the cross-file grace-cache invalidation paired with the write. */
      dropFileName: string;
    }
  | { kind: 'writeOrders'; sourceId: string; orderPlan: OrderWritePlan };

let _dragPendingDrop: PendingDrop | null = null;

export function _dragPointerDown(ctx: DragHandlerContext, e: PointerEvent): void {
  if (ctx.state.engineMode !== 'design' || e.button !== 0) return;
  if (_dragState !== 'idle') return;
  // Normalize a Text-node target up to its owning Element before resolving.
  const target = _normalizeEventTarget(e.target);
  if (!target) return;
  const resolved = resolveDragSource(
    target,
    (el) => ctx.iframeResolver.getSourceLocation(el),
    ctx.renderedComponentPath,
    // Provenance-safe resolver so a decorative drag never commits a raw React 19
    // `_debugStack` (Vite-transformed) line on a cold source map (HYP-49).
    ctx.iframeResolver.getMappedSourceLocation
      ? (el) => ctx.iframeResolver.getMappedSourceLocation?.(el) ?? null
      : undefined,
  );
  if (!resolved) return;

  let dragEl = resolved.el;
  let dragSrc = resolved.source;
  if (ctx.state.selectedIds.length === 1) {
    const selectedRef = ctx.state.selectedIds[0];
    let cur: HTMLElement | null = target;
    while (cur && cur !== document.body) {
      const loc = ctx.iframeResolver.getSourceLocation(cur);
      if (loc) {
        const ref = `${loc.fileName}:${loc.line}:${loc.column}`;
        if (ref === selectedRef) {
          dragEl = cur;
          dragSrc = loc;
          break;
        }
      }
      cur = cur.parentElement;
    }
  }

  _dragSourceId = `${dragSrc.fileName}:${dragSrc.line}:${dragSrc.column}`;
  _dragSourceFilePath = dragSrc.fileName;
  _dragStartX = e.clientX;
  _dragStartY = e.clientY;
  _dragState = 'pending';
  _dragSourceEl = dragEl;

  e.preventDefault();
  _dragPrevBodyUserSelect = document.body.style.userSelect;
  _dragPrevBodyWebkitUserSelect =
    (document.body.style as unknown as { webkitUserSelect?: string }).webkitUserSelect ?? '';
  document.body.style.userSelect = 'none';
  (document.body.style as unknown as { webkitUserSelect?: string }).webkitUserSelect = 'none';

  _dragCapturedPointerId = e.pointerId;
  if (typeof dragEl.setPointerCapture === 'function') {
    try {
      dragEl.setPointerCapture(e.pointerId);
      _dragCapturedTarget = dragEl;
    } catch {
      // setPointerCapture can throw if the target was detached; ignore.
    }
  }
}

export function _dragPointerMove(ctx: DragHandlerContext, e: PointerEvent): void {
  if (_dragCapturedPointerId !== null && e.pointerId !== _dragCapturedPointerId) return;
  if (_dragState === 'pending') {
    const dx = e.clientX - _dragStartX;
    const dy = e.clientY - _dragStartY;
    if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX) {
      _dragState = 'dragging';
      _dragEscapeHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          _dragCleanup();
        }
      };
      document.addEventListener('keydown', _dragEscapeHandler);
      if (_dragSourceEl) {
        const rect = _dragSourceEl.getBoundingClientRect();
        _dragOffsetX = _dragStartX - rect.left;
        _dragOffsetY = _dragStartY - rect.top;

        _dragSourceEl.style.opacity = '0.35';
        _dragSourceEl.style.pointerEvents = 'none';

        const ghost = _dragSourceEl.cloneNode(true) as HTMLElement;
        ghost.className = 'hyper-drag-ghost';
        ghost.removeAttribute('data-uniq-id');
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        ghost.style.left = `${_dragStartX - _dragOffsetX}px`;
        ghost.style.top = `${_dragStartY - _dragOffsetY}px`;
        document.body.appendChild(ghost);
        _dragGhostEl = ghost;

        const srcEl = _dragSourceEl;
        let ghostBg = getComputedStyle(srcEl).backgroundColor;
        if (ghostBg === 'rgba(0, 0, 0, 0)' || ghostBg === 'transparent') {
          let parent = srcEl.parentElement;
          while (parent && parent !== document.body) {
            const parentBg = getComputedStyle(parent).backgroundColor;
            if (parentBg !== 'rgba(0, 0, 0, 0)' && parentBg !== 'transparent') {
              ghostBg = parentBg;
              break;
            }
            parent = parent.parentElement;
          }
        }
        ghost.style.backgroundColor = ghostBg;
        ghost.style.opacity = '0.85';
        ghost.style.position = 'fixed';
        ghost.style.zIndex = '9999';
        ghost.style.pointerEvents = 'none';
        ghost.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
        ghost.style.borderRadius = '4px';
        ghost.style.overflow = 'hidden';

        const indicator = document.createElement('div');
        // Canonical class is `hyper-drop-indicator` — it MUST match the CSS in
        // style-injector.ts (`.hyper-drop-indicator[data-dir]`) and the e2e specs that
        // locate `.hyper-drop-indicator`. A decompose refactor (#383) renamed it to
        // `hyper-drag-indicator` and orphaned both; do not rename it again.
        indicator.className = 'hyper-drop-indicator';
        indicator.style.position = 'fixed';
        indicator.style.zIndex = '9998';
        indicator.style.pointerEvents = 'none';
        indicator.style.backgroundColor = '#3b82f6';
        indicator.style.borderRadius = '2px';
        document.body.appendChild(indicator);
        _dragIndicatorEl = indicator;

        const badge = document.createElement('div');
        badge.className = 'hyper-drag-badge';
        badge.textContent = `${rect.width.toFixed(0)} × ${rect.height.toFixed(0)}`;
        badge.style.position = 'fixed';
        badge.style.zIndex = '10000';
        badge.style.pointerEvents = 'none';
        badge.style.backgroundColor = '#1e293b';
        badge.style.color = '#fff';
        badge.style.padding = '2px 6px';
        badge.style.borderRadius = '4px';
        badge.style.fontSize = '11px';
        badge.style.fontFamily = 'monospace';
        document.body.appendChild(badge);
        _dragBadgeEl = badge;
      }
    }
  }

  if (_dragState !== 'dragging') return;

  if (_dragGhostEl) {
    _dragGhostEl.style.left = `${e.clientX - _dragOffsetX}px`;
    _dragGhostEl.style.top = `${e.clientY - _dragOffsetY}px`;
  }
  if (_dragBadgeEl) {
    _dragBadgeEl.style.left = `${e.clientX + 12}px`;
    _dragBadgeEl.style.top = `${e.clientY - 12}px`;
  }

  // Resolve the drop target by HIT-TESTING the cursor coordinates rather than
  // reading e.target. While the drag is active dragEl.setPointerCapture() redirects
  // every pointermove/pointerup to the captured SOURCE element, so e.target is the
  // dragged element — never the element under the cursor — and the drop target could
  // never resolve to a different node. elementFromPoint does a real geometric hit-test
  // at (clientX, clientY), independent of capture, and skips the drag overlays + source
  // (all pointer-events:none) to return the true drop element. Fall back to e.target
  // normalization only where elementFromPoint is unavailable (e.g. happy-dom unit tests),
  // preserving the over-text coercion for that path.
  const drop = _resolveDrop(ctx, e);
  // Recompute the pending write every move so the LAST hovered target wins. A move
  // over no valid target (null resolve, or targetId === sourceId) CLEARS it, so a drop
  // there writes nothing. The write itself is deferred to `_dragPointerUp`.
  _dragPendingDrop = drop?.pending ?? null;

  if (drop) _updateDropIndicator(drop.dropEl, drop.position);
}

interface ResolvedDrop {
  dropEl: HTMLElement;
  position: 'before' | 'after';
  pending: PendingDrop;
}

/**
 * Hit-test the cursor, resolve the drop target, and build the pending write +
 * indicator geometry inputs. Returns `null` when there is no valid drop (no source,
 * unresolved target, or targetId === sourceId — a drop onto the source itself).
 * Does NOT post any message: the write fires once on pointerup.
 */
function _resolveDrop(ctx: DragHandlerContext, e: PointerEvent): ResolvedDrop | null {
  const target = _resolveDropTarget(e);
  if (!target) return null;
  const resolved = resolveDragSource(
    target,
    (el) => ctx.iframeResolver.getSourceLocation(el),
    ctx.renderedComponentPath,
    // Same provenance-safe resolver as the drag-source side so a decorative DROP
    // target never resolves to a raw transformed line on a cold source map (HYP-49).
    ctx.iframeResolver.getMappedSourceLocation
      ? (el) => ctx.iframeResolver.getMappedSourceLocation?.(el) ?? null
      : undefined,
  );
  if (!resolved || !_dragSourceEl) return null;

  const dropEl = resolved.el;
  const dropSrc = resolved.source;
  if (!dropEl || !dropSrc) return null;
  const sourceId = _dragSourceId;
  const sourceFilePath = _dragSourceFilePath;
  if (!sourceId || !sourceFilePath) return null;

  const rect = dropEl.getBoundingClientRect();
  const position: 'before' | 'after' = _isHorizontalLayout(dropEl)
    ? e.clientX < rect.left + rect.width / 2
      ? 'before'
      : 'after'
    : e.clientY < rect.top + rect.height / 2
      ? 'before'
      : 'after';

  const targetId = `${dropSrc.fileName}:${dropSrc.line}:${dropSrc.column}`;
  if (targetId === sourceId) return null;

  const orderPlan = resolveOrderWritePlan(_dragSourceEl, dropEl, e.clientX, e.clientY, {
    getSourceLocation: (el) => ctx.iframeResolver.getSourceLocation(el),
    isHorizontalLayout: _isHorizontalLayout,
  });
  const pending: PendingDrop = orderPlan
    ? { kind: 'writeOrders', sourceId, orderPlan }
    : {
        kind: 'moveElement',
        sourceId,
        targetId,
        sourceFilePath,
        position,
        dropFileName: dropSrc.fileName,
      };
  return { dropEl, position, pending };
}

/** Update the live drop-indicator line geometry + orientation for the hovered target. */
function _updateDropIndicator(dropEl: HTMLElement, position: 'before' | 'after'): void {
  if (!_dragIndicatorEl) return;
  const dropRect = dropEl.getBoundingClientRect();
  const isHorizontal = _isHorizontalLayout(dropEl);
  // data-dir drives the indicator-line styling in style-injector.ts CSS: a HORIZONTAL
  // layout (side-by-side items) gets a VERTICAL drop line ("v"); a VERTICAL layout
  // (stacked items) gets a HORIZONTAL drop line ("h"). Production never set this before,
  // so the orientation styles never applied.
  _dragIndicatorEl.setAttribute('data-dir', isHorizontal ? 'v' : 'h');
  _dragIndicatorEl.style.width = isHorizontal ? '3px' : `${dropRect.width}px`;
  _dragIndicatorEl.style.height = isHorizontal ? `${dropRect.height}px` : '3px';
  _dragIndicatorEl.style.left = isHorizontal
    ? position === 'before'
      ? `${dropRect.left}px`
      : `${dropRect.right - 3}px`
    : `${dropRect.left}px`;
  _dragIndicatorEl.style.top = isHorizontal
    ? `${dropRect.top}px`
    : position === 'before'
      ? `${dropRect.top}px`
      : `${dropRect.bottom - 3}px`;
}

/**
 * Fire the single deferred drop write (moveElement OR writeOrders) plus the paired
 * grace-cache invalidation. Reads `ctx` for the cache; safe to call with no pending
 * write (no-op). The state-update selection seed is handled parent-side, so it is not
 * re-emitted here.
 */
function _emitPendingDrop(ctx: DragHandlerContext, pending: PendingDrop): void {
  if (pending.kind === 'writeOrders') {
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage(
      {
        type: 'hypercanvas:writeOrders',
        sourceId: pending.sourceId,
        breakpoint: pending.orderPlan.breakpoint,
        entries: pending.orderPlan.entries,
      },
      '*',
    );
    return;
  }

  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage(
    {
      type: 'hypercanvas:moveElement',
      sourceId: pending.sourceId,
      targetId: pending.targetId,
      filePath: pending.sourceFilePath,
      position: pending.position,
    },
    '*',
  );

  ctx.selectionGraceCache.invalidateForFile(pending.sourceFilePath);
  if (pending.dropFileName && pending.dropFileName !== pending.sourceFilePath) {
    ctx.selectionGraceCache.invalidateForFile(pending.dropFileName);
  }
}

export function _dragCleanup(): void {
  if (_dragEscapeHandler) {
    document.removeEventListener('keydown', _dragEscapeHandler);
    _dragEscapeHandler = null;
  }
  if (_dragSourceEl) {
    _dragSourceEl.style.opacity = '';
    _dragSourceEl.style.pointerEvents = '';
  }
  if (_dragGhostEl) {
    _dragGhostEl.remove();
    _dragGhostEl = null;
  }
  if (_dragIndicatorEl) {
    _dragIndicatorEl.remove();
    _dragIndicatorEl = null;
  }
  if (_dragBadgeEl) {
    _dragBadgeEl.remove();
    _dragBadgeEl = null;
  }
  if (_dragCapturedTarget) {
    try {
      _dragCapturedTarget.releasePointerCapture(_dragCapturedPointerId ?? -1);
    } catch {
      // ignore
    }
    _dragCapturedTarget = null;
  }
  _dragCapturedPointerId = null;
  if (_dragPrevBodyUserSelect !== null) {
    document.body.style.userSelect = _dragPrevBodyUserSelect;
    _dragPrevBodyUserSelect = null;
  }
  if (_dragPrevBodyWebkitUserSelect !== null) {
    (document.body.style as unknown as { webkitUserSelect?: string }).webkitUserSelect = _dragPrevBodyWebkitUserSelect;
    _dragPrevBodyWebkitUserSelect = null;
  }
  _dragState = 'idle';
  _dragSourceId = null;
  _dragSourceFilePath = null;
  _dragSourceEl = null;
  // Clear any deferred drop so Escape/cancel writes NOTHING. The write only ever fires
  // from `_dragPointerUp`, which snapshots this before calling cleanup.
  _dragPendingDrop = null;
  _dragSuppressNextClick = true;
  setTimeout(() => {
    _dragSuppressNextClick = false;
  }, 50);
}

export function _dragPointerUp(ctx: DragHandlerContext, e: PointerEvent): void {
  if (_dragCapturedPointerId !== null && e.pointerId !== _dragCapturedPointerId) return;
  // Snapshot the deferred drop BEFORE cleanup (cleanup resets module state). The whole
  // gesture commits EXACTLY ONE write here — never per-move — to avoid racing source rewrites.
  const pending = _dragPendingDrop;
  _dragCleanup();
  if (pending) _emitPendingDrop(ctx, pending);
}

export function _dragClickSuppressor(e: MouseEvent): void {
  if (_dragSuppressNextClick) {
    e.stopPropagation();
    e.preventDefault();
  }
}

export function _dragCleanupForPointerEvent(e: PointerEvent): void {
  if (_dragCapturedPointerId !== null && e.pointerId !== _dragCapturedPointerId) return;
  _dragCleanup();
}

export function _disableNativeDraggableIn(root: ParentNode): void {
  const draggables = root.querySelectorAll('img, a[href]');
  for (let i = 0; i < draggables.length; i++) {
    (draggables[i] as HTMLElement).draggable = false;
  }
}

export function _nativeDragSuppressor(e: DragEvent): void {
  e.preventDefault();
}

export function _mousedownHandler(ctx: DragHandlerContext, e: MouseEvent): void {
  if (ctx.state.engineMode !== 'design') return;
  const target = e.target as HTMLElement;
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  ) {
    e.preventDefault();
  }
}

export const _previewResizeOrig = new Map<string, { width: string; height: string }>();
