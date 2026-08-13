/**
 * Canonical CSS class names for the canvas drag/reorder overlays.
 *
 * Reached at runtime from two sides that MUST agree on the exact token:
 *   - `style-injector.ts` builds the design-mode CSS that styles these classes.
 *   - the VS Code iframe drag script (`iframe-drag-handlers.ts`) adds/removes
 *     them on live DOM nodes during a drag.
 * Both sides go through these constants for DRAG_SOURCE_CLASS and DRAG_GHOST_CLASS.
 * The drag script also sets DROP_INDICATOR_CLASS / DRAG_BADGE_CLASS from here; their
 * CSS lives in style-injector's dense `[data-dir]` + pseudo-element table where the
 * indicator selector repeats ~10x, so that table keeps the literal for readability.
 *
 * Past bug: a decompose refactor (#383) renamed `hyper-drop-indicator` to
 * `hyper-drag-indicator` in ONE of the two places and silently orphaned both
 * the CSS rule and the e2e locators. These constants make the token a single
 * source the compiler keeps in sync, so that class of rename-drift cannot recur.
 */

export const DRAG_SOURCE_CLASS = 'hyper-drag-source';
export const DRAG_GHOST_CLASS = 'hyper-drag-ghost';
export const DROP_INDICATOR_CLASS = 'hyper-drop-indicator';
export const DRAG_BADGE_CLASS = 'hyper-drag-badge';

/**
 * Transient drag-overlay classes that the drag script adds to LIVE DOM nodes for
 * the duration of a gesture. Only `DRAG_SOURCE_CLASS` is ever added to a real
 * source element (the ghost/indicator/badge are standalone nodes), but the whole
 * set is listed so any future addition is stripped too.
 */
const TRANSIENT_DRAG_CLASSES: ReadonlySet<string> = new Set([
  DRAG_SOURCE_CLASS,
  DRAG_GHOST_CLASS,
  DROP_INDICATOR_CLASS,
  DRAG_BADGE_CLASS,
]);

/**
 * Strip the transient drag-overlay classes from a live `className` string.
 *
 * The order-class reorder path reads `element.getAttribute('class')` mid-drag and
 * writes the result back to the user's JSX. Without this, the transient
 * `DRAG_SOURCE_CLASS` (added to the dragged element during the gesture) would be
 * baked into source — and style-injector's `.hyper-drag-source { pointer-events:none }`
 * would then permanently disable the element. Always run a live className through
 * this before persisting it.
 */
export function stripTransientDragClasses(className: string): string {
  return className
    .split(/\s+/)
    .filter((token) => token.length > 0 && !TRANSIENT_DRAG_CLASSES.has(token))
    .join(' ');
}
