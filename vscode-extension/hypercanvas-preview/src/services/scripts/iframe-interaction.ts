/**
 * Iframe interaction script — injected into user's preview iframe by PreviewProxy.
 *
 * Built as IIFE by esbuild, runs inside the preview iframe (not the VS Code webview).
 * Handles click/hover/context menu, keyboard shortcuts, overlay rects, design CSS.
 * Communicates with parent webview via postMessage.
 */

import { attachClickHandler, getItemIndex } from '@shared/canvas-interaction/click-handler';
import { getEmptyContainerRects, isContainerEmpty } from '@shared/canvas-interaction/empty-container-placeholders';
import { createDesignKeydownHandler } from '@shared/canvas-interaction/keyboard-handler';
import { buildDesignStylesCSS } from '@shared/canvas-interaction/style-injector';

/**
 * Scroll an element into view, preferring smooth scrolling when supported.
 * Falls back to basic scrollIntoView in older environments.
 */
function scrollIntoViewCenterSmooth(el: Element): void {
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    try {
      el.scrollIntoView({ block: 'center' });
    } catch {
      el.scrollIntoView();
    }
  }
}

/** Safely escape a value for use inside a CSS attribute selector. */
function safeAttrSelectorValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  // Fallback: escape characters that commonly break attribute selectors
  return value.replace(/["\\[\]]/g, '\\$&');
}

// === State (synced from parent webview via postMessage) ===
const state = {
  selectedIds: [] as string[],
  hoveredId: null as string | null,
  hoveredItemIndex: null as number | null,
  selectedItemIndices: {} as Record<string, number | null>,
  engineMode: 'design' as string,
};
// Always null until VS Code extension supports component instances (SaaS-only for now).
// Change to `let` and sync via stateUpdate when instance support is added.
const activeInstanceId: string | null = null;

// === Shared click handler ===
attachClickHandler(
  document,
  {
    onElementClick: (id, el, _e, itemIndex) => {
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementClick',
          elementId: id,
          itemIndex,
        },
        '*',
      );

      // Empty container clicked → also trigger openPanel so the extension can
      // show the component insertion UI. Overlay click events don't reach the
      // parent frame reliably, so we detect empty containers at the source.
      if (el && isContainerEmpty(el)) {
        // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
        window.parent.postMessage(
          {
            type: 'hypercanvas:openPanel',
            elementId: id,
          },
          '*',
        );
      }
    },
    onElementHover: (id, _el, itemIndex) =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementHover',
          elementId: id,
          itemIndex,
        },
        '*',
      ),
    onEmptyClick: () =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage({ type: 'hypercanvas:emptyClick' }, '*'),
    getMode: () => state.engineMode as 'design' | 'interact',
  },
  { getActiveInstanceId: () => activeInstanceId },
);

// === Shared keyboard handler ===
const { handler: keydownHandler } = createDesignKeydownHandler({
  getState: () => ({
    selectedIds: state.selectedIds,
    activeInstanceId,
  }),
  getDocument: () => document,
  callbacks: {
    onSelectElement: (id) =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementClick',
          elementId: id,
          itemIndex: null,
        },
        '*',
      ),
    onSelectMultiple: (ids) =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:selectMultiple',
          elementIds: ids,
        },
        '*',
      ),
    onClearSelection: () =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage({ type: 'hypercanvas:emptyClick' }, '*'),
    onDeleteElements: (ids) =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:deleteElements',
          elementIds: ids,
        },
        '*',
      ),
  },
  isDesignMode: () => state.engineMode === 'design',
});
// Forward unhandled modifier keystrokes to parent webview so VS Code's
// built-in keyboard forwarding picks them up (Cmd+S, Cmd+P, etc.).
// Without this, the iframe swallows all events and VS Code shortcuts break.
// See: https://github.com/Microsoft/vscode/issues/65333
function keydownForwardingHandler(e: KeyboardEvent): void {
  const consumed = keydownHandler(e);
  if (consumed) return;

  // In interact mode, keep all events inside the iframe — the user
  // is interacting with the app (forms, inputs, app-level shortcuts).
  if (state.engineMode !== 'design') return;

  // Only forward modifier combos — plain keystrokes stay in the iframe
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return;

  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage(
    {
      type: 'hypercanvas:keydown',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      repeat: e.repeat,
    },
    '*',
  );
}
document.addEventListener('keydown', keydownForwardingHandler, true);

// === Context menu handler ===
const contextMenuHandler = (e: MouseEvent) => {
  if (state.engineMode !== 'design') return;
  e.preventDefault();
  e.stopPropagation();

  const target = e.target as HTMLElement;
  const element = target.closest('[data-uniq-id]') as HTMLElement | null;
  const elementId = element?.dataset.uniqId ?? null;

  const itemIndex = element && elementId ? getItemIndex(element, elementId, document, activeInstanceId) : null;

  // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
  window.parent.postMessage(
    {
      type: 'hypercanvas:contextMenu',
      elementId,
      itemIndex,
      x: e.clientX,
      y: e.clientY,
    },
    '*',
  );
};
document.addEventListener('contextmenu', contextMenuHandler, true);

// === Focus prevention in design mode (mousedown, not focusin) ===
const mousedownHandler = (e: MouseEvent) => {
  if (state.engineMode !== 'design') return;
  const target = e.target as HTMLElement;
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  ) {
    e.preventDefault(); // Actually prevents focus on mousedown
  }
};
document.addEventListener('mousedown', mousedownHandler, true);

// === Overlay rects with dirty-flag optimization ===
let prevRectsJSON = '';
let needsOverlayUpdate = true;
let overlayRafScheduled = false;

function scheduleOverlayLoopIfNeeded(): void {
  if (!overlayRafScheduled) {
    overlayRafScheduled = true;
    requestAnimationFrame(sendOverlayRects);
  }
}

function getIndexedElementOrNull(elements: NodeListOf<Element>, index: number | null | undefined): Element | null {
  if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < elements.length) {
    return elements[index];
  }
  return null;
}

function sendOverlayRects(): void {
  overlayRafScheduled = false;

  if (!needsOverlayUpdate) {
    // Nothing changed; do not reschedule another frame to avoid a perpetual RAF loop.
    return;
  }
  needsOverlayUpdate = false;
  const rects: Array<{
    key: string;
    left: number;
    top: number;
    width: number;
    height: number;
    type: string;
  }> = [];

  // Selection rects
  for (let i = 0; i < state.selectedIds.length; i++) {
    const id = state.selectedIds[i];
    let selector = `[data-uniq-id="${safeAttrSelectorValue(id)}"]`;
    if (activeInstanceId) {
      selector = `[data-canvas-instance-id="${safeAttrSelectorValue(activeInstanceId)}"] ${selector}`;
    }
    const elements = document.querySelectorAll(selector);
    const itemIdx = state.selectedItemIndices[id];

    const primaryElement = getIndexedElementOrNull(elements, itemIdx);

    if (primaryElement) {
      const rect = primaryElement.getBoundingClientRect();
      rects.push({
        key: `select-${id}-${itemIdx}`,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        type: 'selection',
      });
    } else {
      for (let j = 0; j < elements.length; j++) {
        const rect = elements[j].getBoundingClientRect();
        rects.push({
          key: `select-${id}-${j}`,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          type: 'selection',
        });
      }
    }
  }

  // Hover rect
  if (state.hoveredId) {
    let hSelector = `[data-uniq-id="${safeAttrSelectorValue(state.hoveredId)}"]`;
    if (activeInstanceId) {
      hSelector = `[data-canvas-instance-id="${safeAttrSelectorValue(activeInstanceId)}"] ${hSelector}`;
    }
    const hElements = document.querySelectorAll(hSelector);
    const hEl =
      getIndexedElementOrNull(hElements, state.hoveredItemIndex) || (hElements.length > 0 ? hElements[0] : null);
    if (hEl) {
      const hRect = hEl.getBoundingClientRect();
      rects.push({
        key: `hover-${state.hoveredId}`,
        left: hRect.left,
        top: hRect.top,
        width: hRect.width,
        height: hRect.height,
        type: 'hover',
      });
    }
  }

  // Placeholder rects for empty containers (design mode only)
  const placeholderRects = state.engineMode !== 'interact' ? getEmptyContainerRects(document) : [];

  const payload = JSON.stringify({ rects, placeholderRects });
  if (payload !== prevRectsJSON) {
    prevRectsJSON = payload;
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage({ type: 'hypercanvas:overlayRects', rects, placeholderRects }, '*');
  }

  // Only continue the overlay loop while updates are needed or overlays are active.
  if (needsOverlayUpdate || state.selectedIds.length > 0 || state.hoveredId !== null || placeholderRects.length > 0) {
    scheduleOverlayLoopIfNeeded();
  }
}

// Throttle overlay updates triggered by high-frequency DOM/layout events.
// 50 ms (~20 FPS) chosen to balance overlay responsiveness with DOM/layout change frequency.
const OVERLAY_THROTTLE_DELAY_MS = 50;
let overlayUpdateTimeoutId: ReturnType<typeof setTimeout> | null = null;

function scheduleThrottledOverlayUpdate(): void {
  needsOverlayUpdate = true;
  if (overlayUpdateTimeoutId !== null) return;
  overlayUpdateTimeoutId = setTimeout(() => {
    overlayUpdateTimeoutId = null;
    scheduleOverlayLoopIfNeeded();
  }, OVERLAY_THROTTLE_DELAY_MS);
}

// Mark overlays dirty when DOM/layout changes
const overlayMutationObserver =
  typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => {
        scheduleThrottledOverlayUpdate();
      })
    : null;

if (overlayMutationObserver && document.body) {
  overlayMutationObserver.observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true,
  });
}

const overlayResizeObserver =
  typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
        scheduleThrottledOverlayUpdate();
      })
    : null;

if (overlayResizeObserver && document.body) {
  overlayResizeObserver.observe(document.body);
}

// Also mark dirty on scroll and window resize
const overlayScrollHandler = () => {
  scheduleThrottledOverlayUpdate();
};
const overlayResizeHandler = () => {
  scheduleThrottledOverlayUpdate();
};
window.addEventListener('scroll', overlayScrollHandler, true);
window.addEventListener('resize', overlayResizeHandler);

// Start the loop
scheduleOverlayLoopIfNeeded();

// Clean up observers and listeners when the iframe is unloaded
window.addEventListener('unload', () => {
  if (overlayUpdateTimeoutId !== null) clearTimeout(overlayUpdateTimeoutId);
  if (overlayMutationObserver) overlayMutationObserver.disconnect();
  if (overlayResizeObserver) overlayResizeObserver.disconnect();
  window.removeEventListener('scroll', overlayScrollHandler, true);
  window.removeEventListener('resize', overlayResizeHandler);
  document.removeEventListener('keydown', keydownForwardingHandler, true);
  document.removeEventListener('contextmenu', contextMenuHandler, true);
  document.removeEventListener('mousedown', mousedownHandler, true);
});

// === Design mode CSS (shared) ===
function updateDesignStyles(mode: string): void {
  const styleId = 'hyper-canvas-dynamic-styles';
  let style = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }

  style.textContent = buildDesignStylesCSS({
    mode: mode === 'interact' ? 'interact' : 'design',
  });

  if (mode !== 'interact') {
    if (document.body) document.body.classList.add('design-mode');
  } else {
    if (document.body) document.body.classList.remove('design-mode');
  }
}

// === Receive messages from parent webview ===
// nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview iframe, origin not applicable
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'hypercanvas:stateUpdate') {
    if (msg.selectedIds !== undefined) state.selectedIds = msg.selectedIds;
    if (msg.hoveredId !== undefined) state.hoveredId = msg.hoveredId;
    if (msg.hoveredItemIndex !== undefined) state.hoveredItemIndex = msg.hoveredItemIndex;
    if (msg.selectedItemIndices !== undefined) state.selectedItemIndices = msg.selectedItemIndices;
    if (msg.engineMode !== undefined) {
      state.engineMode = msg.engineMode;
      updateDesignStyles(state.engineMode);
    }
    needsOverlayUpdate = true;
    scheduleOverlayLoopIfNeeded();
    return;
  }

  // Go to Visual: select element and scroll to it
  if (msg.type === 'hypercanvas:goToVisual') {
    state.selectedIds = [msg.elementId];
    state.selectedItemIndices = {};
    const el = document.querySelector(`[data-uniq-id="${safeAttrSelectorValue(msg.elementId)}"]`);
    if (el) scrollIntoViewCenterSmooth(el);
    needsOverlayUpdate = true;
    scheduleOverlayLoopIfNeeded();
    return;
  }

  // Content extraction requests from extension (Copy Text / Copy as HTML)
  if (msg.type === 'hypercanvas:getElementText') {
    const el = document.querySelector(`[data-uniq-id="${safeAttrSelectorValue(msg.elementId)}"]`) as HTMLElement | null;
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage(
      {
        type: 'hypercanvas:elementContentResult',
        requestId: msg.requestId,
        text: el ? el.innerText : null,
        html: null,
      },
      '*',
    );
    return;
  }
  if (msg.type === 'hypercanvas:getElementHTML') {
    const el = document.querySelector(`[data-uniq-id="${safeAttrSelectorValue(msg.elementId)}"]`) as HTMLElement | null;
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage(
      {
        type: 'hypercanvas:elementContentResult',
        requestId: msg.requestId,
        text: null,
        html: el ? el.outerHTML : null,
      },
      '*',
    );
    return;
  }
});

// Initialize design mode
updateDesignStyles(state.engineMode);
