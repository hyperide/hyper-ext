/**
 * @file HYP-990 (M2) — the write-scoped style-verify marker constants (master spec §9.3
 * "styleVersion sentinel"), in a dependency-free module so BOTH the host style-write path
 * (`style-wrap-retry.ts`, `ast-update-utils.ts` — Node/@babel) and the iframe verify reader
 * (`scripts/dom-utils.ts` — browser DOM) can share the single source of truth without either side
 * pulling the other's runtime (babel into the browser bundle, or `window`/`document` into Node).
 *
 * - {@link WRITE_MARKER_ATTR} is the JSX/DOM attribute stamped on the auto-wrap `<div>` carrying a
 *   per-write id.
 * - {@link WRITE_MARKER_VERIFY_PREFIX} + that id is the pseudo-elementId the host passes to
 *   `verifyComputedStyle`; the iframe recognises the prefix and reads the marked wrapper's child
 *   instead of resolving a fuzzy source nodeRef.
 */
export const WRITE_MARKER_ATTR = 'data-hc-writeid';
export const WRITE_MARKER_VERIFY_PREFIX = 'hc-writeid:';

/**
 * HYP-990 (Opus) — sentinel key the iframe returns in a computed-style snapshot when the marked
 * wrapper IS in the DOM but has NO element child (a text/fragment/portal component). Lets the host
 * keep-REPORT that genuine "no DOM element root" case while keeping a `null` snapshot (wrapper ABSENT
 * — HMR pending) SILENT (§9.3). Shared here (dependency-free) so host + iframe agree on the key.
 */
export const NO_ELEMENT_ROOT_SENTINEL = 'hcNoElementRoot';

/** Build the verify id the host passes to `verifyComputedStyle`: `hc-writeid:<marker>`. The iframe
 *  strips the prefix and addresses ONLY the marked wrapper's child. There is deliberately NO fallback
 *  nodeRef: a fallback resolved through the fuzzy source lookup could match the injected wrapper itself
 *  (the very false-positive the marker exists to prevent — codex full panel). A component with no
 *  element root (text/fragment/portal/null) is instead left UNVERIFIABLE → keep-report (see
 *  ast-update-utils `verifyLanded`). */
export function encodeMarkerVerifyId(marker: string): string {
  return `${WRITE_MARKER_VERIFY_PREFIX}${marker}`;
}

/**
 * PERSISTENT ownership marker on an auto-wrap `<div>` (review, Opus/Fable). Unlike the TRANSIENT
 * {@link WRITE_MARKER_ATTR} (stripped after each verify), this stays on the wrapper across writes so a
 * later edit can tell OUR auto-wrap from a user-authored `<div style={{…}}>` and safely update it in
 * place — WITHOUT ever mutating a user's own element (which may have a different box, and whose
 * formatting a reprint would destroy). It carries no value; its mere presence marks the div as ours.
 */
export const AUTOWRAP_OWNER_ATTR = 'data-hc-autowrap';
