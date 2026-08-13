/**
 * @file Pointer/mouse event-target normalization.
 *
 * Accessed via: click-handler.ts (click/pointerup/mouseover) and the extension's
 *   iframe-drag-handlers.ts (_dragPointerDown / _dragPointerMove).
 * Assumptions: called with a live DOM `EventTarget` from a user-initiated event.
 *
 * Why this exists: a click/pointerdown/pointermove over visible text reports
 * `e.target` as a Text node (nodeType 3). Text nodes have no `tagName` /
 * `getAttribute`, so any handler that reaches `target.tagName.toUpperCase()` or
 * `target.getAttribute(...)` throws (e2e defect #13:
 * `TypeError: i.getAttribute is not a function`, ~333 cascade failures). Coercing
 * a non-Element node up to its owning Element makes a press/hover over a label's
 * text resolve the owning control instead of crashing.
 */

/**
 * Return the Element that owns an event target.
 *
 * Real Elements — including SVG (`<svg>`, `<path>`), which are valid interaction
 * targets — are returned unchanged. A non-Element node (e.g. a Text node) is
 * coerced up to its `parentElement`. Returns null when there is no owning Element.
 *
 * Element-ness is detected by a string `tagName` rather than `instanceof Element`:
 * a Text node has no `tagName` (so it coerces up), while every HTML/SVG element —
 * and the lightweight `{ tagName }` element stubs used in unit tests — has one and
 * passes through. The result is typed `HTMLElement` to match the existing call
 * sites; SVG flows through because downstream resolvers use only `Element` APIs.
 */
export function normalizeEventTarget(node: EventTarget | null): HTMLElement | null {
  if (node == null) return null;
  if (typeof (node as Partial<Element>).tagName === 'string') return node as HTMLElement;
  return ((node as Node).parentElement ?? null) as HTMLElement | null;
}
