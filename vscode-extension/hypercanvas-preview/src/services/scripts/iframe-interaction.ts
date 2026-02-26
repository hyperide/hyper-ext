/**
 * Iframe interaction script — injected into user's preview iframe by PreviewProxy.
 *
 * Built as IIFE by esbuild, runs inside the preview iframe (not the VS Code webview).
 * Handles click/hover/context menu, keyboard shortcuts, overlay rects, design CSS.
 * Communicates with parent webview via postMessage.
 */

import { attachClickHandler, getItemIndex } from '@shared/canvas-interaction/click-handler';
import { createDesignKeydownHandler } from '@shared/canvas-interaction/keyboard-handler';

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
    onElementClick: (id, _el, _e, itemIndex) =>
      // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
      window.parent.postMessage(
        {
          type: 'hypercanvas:elementClick',
          elementId: id,
          itemIndex,
        },
        '*',
      ),
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
document.addEventListener('keydown', keydownHandler, true);

// === Context menu handler ===
document.addEventListener(
  'contextmenu',
  function (e: MouseEvent) {
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
  },
  true,
);

// === Focus prevention in design mode (mousedown, not focusin) ===
document.addEventListener(
  'mousedown',
  function (e: MouseEvent) {
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
  },
  true,
);

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

function sendOverlayRects(): void {
  overlayRafScheduled = false;

  if (!needsOverlayUpdate) {
    // Nothing changed, schedule next check
    scheduleOverlayLoopIfNeeded();
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
    let selector = `[data-uniq-id="${id}"]`;
    if (activeInstanceId) {
      selector = `[data-canvas-instance-id="${activeInstanceId}"] ${selector}`;
    }
    const elements = document.querySelectorAll(selector);
    const itemIdx = state.selectedItemIndices[id];

    if (itemIdx !== null && itemIdx !== undefined && elements[itemIdx]) {
      const rect = elements[itemIdx].getBoundingClientRect();
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
    let hSelector = `[data-uniq-id="${state.hoveredId}"]`;
    if (activeInstanceId) {
      hSelector = `[data-canvas-instance-id="${activeInstanceId}"] ${hSelector}`;
    }
    const hElements = document.querySelectorAll(hSelector);
    const hEl =
      state.hoveredItemIndex !== null && hElements[state.hoveredItemIndex]
        ? hElements[state.hoveredItemIndex]
        : hElements[0];
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

  const rectsJSON = JSON.stringify(rects);
  if (rectsJSON !== prevRectsJSON) {
    prevRectsJSON = rectsJSON;
    // nosemgrep: wildcard-postmessage-configuration -- iframe->parent communication within VS Code webview
    window.parent.postMessage({ type: 'hypercanvas:overlayRects', rects }, '*');
  }

  scheduleOverlayLoopIfNeeded();
}

// Mark overlays dirty when DOM/layout changes
const overlayMutationObserver =
  typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => {
        needsOverlayUpdate = true;
        scheduleOverlayLoopIfNeeded();
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
        needsOverlayUpdate = true;
        scheduleOverlayLoopIfNeeded();
      })
    : null;

if (overlayResizeObserver && document.body) {
  overlayResizeObserver.observe(document.body);
}

// Also mark dirty on scroll and window resize
window.addEventListener(
  'scroll',
  () => {
    needsOverlayUpdate = true;
    scheduleOverlayLoopIfNeeded();
  },
  true,
);
window.addEventListener('resize', () => {
  needsOverlayUpdate = true;
  scheduleOverlayLoopIfNeeded();
});

// Start the loop
scheduleOverlayLoopIfNeeded();

// === Design mode CSS ===
function updateDesignStyles(mode: string): void {
  const styleId = 'hyper-canvas-dynamic-styles';
  let style = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  if (mode !== 'interact') {
    style.textContent =
      'body.design-mode, body.design-mode * { cursor: default !important; }\n' +
      'div[data-uniq-id]:empty { min-height: 120px; border: 2px dashed #cbd5e1; background-color: #f8fafc; border-radius: 8px; position: relative; transition: all 0.2s ease; }\n' +
      'div[data-uniq-id]:empty::after { content: "Drop elements here"; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #94a3b8; font-size: 14px; font-weight: 500; pointer-events: none; }\n' +
      'div[data-uniq-id]:empty:hover { border-color: #94a3b8; background-color: #f1f5f9; }';
    if (document.body) document.body.classList.add('design-mode');
  } else {
    style.textContent = '';
    if (document.body) document.body.classList.remove('design-mode');
  }
}

// === Receive messages from parent webview ===
// nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview iframe, origin not applicable
window.addEventListener('message', function (event: MessageEvent) {
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
    const el = document.querySelector(`[data-uniq-id="${msg.elementId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Content extraction requests from extension (Copy Text / Copy as HTML)
  if (msg.type === 'hypercanvas:getElementText') {
    const el = document.querySelector(`[data-uniq-id="${msg.elementId}"]`) as HTMLElement | null;
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
    const el = document.querySelector(`[data-uniq-id="${msg.elementId}"]`) as HTMLElement | null;
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
