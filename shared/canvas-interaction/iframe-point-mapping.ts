/**
 * @file Single source of truth for mapping an iframe-local pointer coordinate
 * (the previewed app's own `event.clientX/clientY`, relative to the iframe's
 * top-left) into the surrounding document's viewport coordinates.
 *
 * Accessed via:
 *  - SaaS: client/components/CanvasElementContextMenu.tsx (iframe contextmenu handler)
 *  - EXT:  vscode-extension/.../webview-preview-panel/useCanvasInteraction.ts
 *          (hypercanvas:contextMenu message handler)
 *
 * Why it exists: a context menu / overlay that portals to `document.body` and
 * positions itself with `position: fixed` lives in the OUTER document's viewport
 * space, while the click coordinate it reacts to is reported in the INNER iframe's
 * space. When the iframe sits flush at the surface top those spaces coincide and
 * the offset is ~0. But in EXT app-mode the address-bar row reflows the iframe DOWN
 * by its own height; without adding the iframe's `getBoundingClientRect()` offset
 * the menu lands one bar-height above the cursor (HYP-752 app-preview overlap fix).
 *
 * This helper is intentionally framework-free: it takes the iframe's bounding rect
 * (left/top) rather than the element, so it is trivially unit-testable and has no
 * DOM dependency. Callers pass `iframe.getBoundingClientRect()`.
 *
 * Past bug: the EXT path forwarded the raw iframe-local coords straight to the
 * fixed portal menu, so right-click menus opened a bar-height too high in app-mode.
 */

/** The pieces of a DOMRect this mapping needs — just the iframe's viewport offset. */
export interface IframeOffset {
  left: number;
  top: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Translate an iframe-local point into the host document's viewport coordinates.
 *
 * @param offset - The iframe's `getBoundingClientRect()` (only left/top are read).
 *   Pass `null`/`undefined` when the iframe is unavailable — the point is then
 *   returned unchanged (offset treated as 0,0), which is the correct degenerate
 *   case for an iframe at the viewport origin.
 * @param x - The iframe-local clientX (relative to the iframe's left edge).
 * @param y - The iframe-local clientY (relative to the iframe's top edge).
 * @returns The point in host-viewport space (`offset.left + x`, `offset.top + y`).
 */
export function iframeLocalToViewport(offset: IframeOffset | null | undefined, x: number, y: number): Point {
  return {
    x: (offset?.left ?? 0) + x,
    y: (offset?.top ?? 0) + y,
  };
}
