import { resolveDragSource } from '@shared/canvas-interaction/drag-source-resolver';
import { isHorizontalLayout as _isHorizontalLayoutShared } from '@shared/canvas-interaction/drop-indicator-orientation';
import { normalizeEventTarget } from '@shared/canvas-interaction/normalize-event-target';
import { resolveOrderWritePlan } from './iframe-drag-order';
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
        indicator.className = 'hyper-drag-indicator';
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

  // Normalize the drop target the same way as pointerdown: over visible text
  // e.target is a Text node, which resolveDragSource rejects — coercing up to the
  // owning Element keeps the drop indicator resolving over text-heavy targets.
  const target = _normalizeEventTarget(e.target);
  if (!target) return;
  const resolved = resolveDragSource(
    target,
    (el) => ctx.iframeResolver.getSourceLocation(el),
    ctx.renderedComponentPath,
  );
  if (!resolved || !_dragSourceEl) return;

  const dropEl = resolved.el;
  const dropSrc = resolved.source;
  if (!dropEl || !dropSrc) return;
  const sourceId = _dragSourceId;
  const sourceFilePath = _dragSourceFilePath;
  if (!sourceId || !sourceFilePath) return;

  const rect = dropEl.getBoundingClientRect();
  const position: 'before' | 'after' = _isHorizontalLayout(dropEl)
    ? e.clientX < rect.left + rect.width / 2
      ? 'before'
      : 'after'
    : e.clientY < rect.top + rect.height / 2
      ? 'before'
      : 'after';

  const targetId = `${dropSrc.fileName}:${dropSrc.line}:${dropSrc.column}`;
  if (targetId === sourceId) return;

  const orderPlan = resolveOrderWritePlan(_dragSourceEl, dropEl, e.clientX, e.clientY, {
    getSourceLocation: (el) => ctx.iframeResolver.getSourceLocation(el),
    isHorizontalLayout: _isHorizontalLayout,
  });
  if (orderPlan) {
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage(
      {
        type: 'hypercanvas:writeOrders',
        sourceId,
        breakpoint: orderPlan.breakpoint,
        entries: orderPlan.entries,
      },
      '*',
    );
    return;
  }

  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage(
    {
      type: 'hypercanvas:moveElement',
      sourceId,
      targetId,
      filePath: sourceFilePath,
      position,
    },
    '*',
  );

  ctx.selectionGraceCache.invalidateForFile(sourceFilePath);
  if (dropSrc.fileName && dropSrc.fileName !== sourceFilePath) {
    ctx.selectionGraceCache.invalidateForFile(dropSrc.fileName);
  }

  if (_dragIndicatorEl) {
    const dropRect = dropEl.getBoundingClientRect();
    const isHorizontal = _isHorizontalLayout(dropEl);
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
  _dragSuppressNextClick = true;
  setTimeout(() => {
    _dragSuppressNextClick = false;
  }, 50);
}

export function _dragPointerUp(_ctx: DragHandlerContext, e: PointerEvent): void {
  if (_dragCapturedPointerId !== null && e.pointerId !== _dragCapturedPointerId) return;
  _dragCleanup();
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
