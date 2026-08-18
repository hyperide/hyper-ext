/**
 * @file HYP-901 — the auto-wrap RETRY candidate for a style write whose target doesn't forward
 * `style`/`className` to the DOM.
 *
 * Accessed via: ast-update-utils.ts's verify-and-retry loop, AFTER `checkStyleForwarding`
 * (style-forwarding-check.ts) says `not-forwarding`, or after a `landed` verify check fails for
 * an `unknown` target. Wraps the JSX call site itself — e.g. `<HostRoutePage .../>` inside
 * `OrgSettingsPage.tsx` — in a plain `<div style={...}>`, NOT the component's own definition, so
 * the edit stays scoped to this ONE usage and never mutates a shared component every other call
 * site also renders.
 *
 * Master spec docs/specs/2026-06-12-styles-system-master-spec.md §11.4 "wrapper-promotion
 * decision procedure" describes the full, general version of this idea (multi-select, feature-
 * flagged, 14 static + runtime guards, opt-in confirmation UX). This module is the narrow,
 * always-on slice scoped to the single-element HYP-901 style-write retry: it keeps only the
 * CHEAP static guards that matter for THIS failure mode (no `ref`/`key` on the target, no
 * structurally-constrained parent, no layout-affecting property in the edit). The guards §11.4
 * needs for its heavier dimension-match / layout-semantics / selector-hijack checks are NOT
 * reimplemented here — instead, the caller's B1 runtime verify is the actual safety net: an
 * ineligible OR verify-failed wrap always falls back to leaving the source untouched, never a
 * guessed structural change nobody checked.
 *
 * Does NOT reuse `wrapElementInAST` (lib/ast/operations.ts, the existing manual "Wrap in..."
 * context-menu action): it replaces the ORIGINAL node object in place, and recast's incremental
 * printer keeps that node's stale `.start`/`.end`/paren metadata from its old position — for a
 * JSX element sitting directly inside a parenthesized `return (...)`, the enclosing parens (and
 * neighboring attribute/text bytes) get spliced into the reprinted output as garbled literal
 * text (confirmed via a direct `wrapElement()` repro against the HYP-901 HostRoutePage fixture —
 * a real, pre-existing bug, filed as a follow-up, NOT fixed here to keep this change scoped; the
 * shared `cloneElement`/`t.cloneNode(el, true)` helper does NOT fix it either — babel's default
 * `withoutLoc` is `false`, so even a "clone" keeps the same stale position range unless told not
 * to). `valueToJSXAttribute` (lib/ast/mutator.ts) has a second, independent bug for THIS use
 * case: its JSON-stringify round-trip parses `{"backgroundColor":"#ff00aa"}` as a top-level
 * program, where a leading `{` is a BLOCK statement, not an object literal, so the parse silently
 * falls through to the string-literal fallback and would emit
 * `style={'{"backgroundColor":"#ff00aa"}'}` — a STRING, not a style object. This module builds
 * the wrapper from a POSITION-STRIPPED clone (`t.cloneNode(element, true, true)` — deep clone,
 * `withoutLoc: true`, so recast reprints the whole subtree fresh instead of splicing stale
 * ranges) and constructs the `style` object directly via `t.objectExpression`/`t.objectProperty`,
 * avoiding both bugs rather than depending on them.
 */

import * as t from '@babel/types';
import type { FindElementResult } from '@lib/types';
import { findAllJSXElements } from '@lib/ast/traverser';
import { jsxOpeningTagName } from './ast-utils';
import { AUTOWRAP_OWNER_ATTR, WRITE_MARKER_ATTR } from './style-verify-marker';

/**
 * Properties whose landing on the injected wrapper is OBSERVABLE from the wrapped child, so the
 * runtime verify (which reads the child's rendered DOM, not the uninjectable wrapper) can prove
 * whether the edit became visible. Two kinds are observable:
 *  - `backgroundColor` — judged via `effectiveBackgroundColor` (painted-through; changes when the
 *    wrapper paints through, unchanged when an opaque child root covers it). HYP-987 P1 #1.
 *  - CSS INHERITED properties — the child's computed value reflects the wrapper's value (unless the
 *    child sets its own, in which case verify fails-closed to the warning, which is honest).
 *
 * Everything else — non-inherited visuals a bare wrapper CAN carry but the child never reflects
 * (`opacity`, `border*`, `boxShadow`, `filter`, `borderRadius`, `background`/`backgroundImage`
 * gradients, `outline`), AND every layout-affecting property (a NEW `<div>` box perturbs
 * flow/flex/grid participation the master spec §11.4 guards 4/5/12 would police) — is NOT
 * auto-wrapped: it surfaces the warning instead of a wrap we cannot verify (fail-closed; HYP-987
 * P1 codex — a wrapped-but-unobservable `opacity` was visibly effective yet always false-rolled-
 * back). Verifying the wrapper directly (Milestone 2) would widen this set.
 */
const CHILD_VERIFIABLE_PROPERTIES: ReadonlySet<string> = new Set([
  'backgroundColor',
  // Inherited properties (child computed reflects the wrapper's value):
  'color',
  'cursor',
  'direction',
  'font',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'letterSpacing',
  'lineHeight',
  'listStyle',
  'listStyleType',
  'listStylePosition',
  'listStyleImage',
  'quotes',
  'textAlign',
  'textAlignLast',
  'textIndent',
  'textTransform',
  'textShadow',
  'visibility',
  'whiteSpace',
  'wordBreak',
  'wordSpacing',
  'overflowWrap',
  'tabSize',
  'caretColor',
  'hyphens',
]);

/** Parents where inserting a bare `<div>` child is invalid HTML/React (table/list/select families). */
const STRUCTURAL_PARENT_DENYLIST: ReadonlySet<string> = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'colgroup',
  'select',
  'optgroup',
  'datalist',
  'ul',
  'ol',
]);

/**
 * True when EVERY edited property's landing is observable from the wrapped child (see
 * {@link CHILD_VERIFIABLE_PROPERTIES}), so an auto-wrap of these properties can be runtime-verified.
 * A property outside this set surfaces the warning rather than an unverifiable wrap.
 *
 * CSS custom properties (`--brand`) count as verifiable (HYP-987, opus/codex): they INHERIT, so the
 * wrapped child's computed value reflects the wrapper's — and `extractComputedStyleForProperties`
 * reads them verbatim, so the end-to-end verify works. Without this a `--brand` edit bailed to the
 * warning before any wrap, contradicting the custom-property read support.
 *
 * The custom-property shape MUST match the one the verify reader accepts
 * (`CSS_CUSTOM_PROPERTY` in scripts/dom-utils.ts — SYNC with it): a non-ASCII name like `--café`
 * that this gate accepted but the reader dropped would be wrapped yet never verified → false
 * rollback (HYP-987 P2 codex). Both are `--` + ASCII `[a-zA-Z0-9_-]`.
 */
const CSS_CUSTOM_PROPERTY = /^--[a-zA-Z0-9_-]+$/;

export function hasOnlyChildVerifiableProperties(styles: Record<string, string>): boolean {
  return Object.keys(styles).every((key) => CSS_CUSTOM_PROPERTY.test(key) || CHILD_VERIFIABLE_PROPERTIES.has(key));
}

/**
 * Cheap static eligibility for auto-wrapping `result`'s element. Does NOT check the edited
 * properties — call {@link hasOnlyVisualProperties} separately so callers can log/report the two
 * exclusion reasons distinctly.
 */
export function isWrapEligible(result: FindElementResult): boolean {
  const hasRefOrKey = result.element.openingElement.attributes.some(
    (attr) =>
      t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && (attr.name.name === 'ref' || attr.name.name === 'key'),
  );
  if (hasRefOrKey) return false;

  const parent = result.path.parent;
  if (t.isJSXElement(parent)) {
    const parentTag = jsxOpeningTagName(parent.openingElement.name);
    if (parentTag && STRUCTURAL_PARENT_DENYLIST.has(parentTag.toLowerCase())) return false;
  }
  return true;
}

/**
 * Wrap `result`'s element in a transparent `<div data-hc-writeid={writeMarker} style={...}>`,
 * mutating the AST in place. Wraps a CLONE of the original node (not the node object itself — see the
 * file header for why) and builds the `style` object directly rather than through the generic
 * JSON-round-trip attribute builder. `writeMarker` is the HYP-990 write-scoped sentinel
 * ({@link WRITE_MARKER_ATTR}) the runtime verify addresses and rollback keys on. Caller is
 * responsible for re-printing/writing the AST and for having already checked {@link isWrapEligible} +
 * {@link hasOnlyChildVerifiableProperties}.
 */
export function applyWrapCandidate(
  result: FindElementResult,
  styles: Record<string, string>,
  writeMarker: string,
): boolean {
  // Persistent ownership marker (kept across writes) + transient per-write verify marker (stripped
  // after a keep). The ownership marker lets a later edit recognise THIS as our auto-wrap and never
  // mistake a user's `<div style={{…}}>` for ours (review, Opus/Fable).
  const ownerAttr = t.jsxAttribute(t.jsxIdentifier(AUTOWRAP_OWNER_ATTR), null);
  const markerAttr = t.jsxAttribute(t.jsxIdentifier(WRITE_MARKER_ATTR), t.stringLiteral(writeMarker));
  const styleAttr = t.jsxAttribute(
    t.jsxIdentifier('style'),
    t.jsxExpressionContainer(buildStyleObjectExpression(styles)),
  );
  // withoutLoc: true — a clone that KEEPS the original's position range still makes recast
  // treat it as "reuse these original source bytes", which is exactly the stale-splice bug this
  // function exists to avoid (see file header). Stripping loc forces a full fresh reprint.
  const clonedElement = t.cloneNode(result.element, true, true) as t.JSXElement;
  const wrapper = t.jsxElement(
    t.jsxOpeningElement(t.jsxIdentifier('div'), [ownerAttr, markerAttr, styleAttr]),
    t.jsxClosingElement(t.jsxIdentifier('div')),
    [clonedElement],
    false,
  );
  result.path.replaceWith(wrapper);
  return true;
}

/**
 * HYP-990 — find the unique auto-wrap `<div>` carrying `data-hc-writeid="<writeMarker>"` and return
 * its path. Because the marker is per-write unique, this is unambiguous even when the file contains a
 * structurally-identical user-authored `<div style={sameBg}>` (which the M1 structure-only
 * {@link unwrapStyleWrapper} could not tell apart). Returns null when no wrapper carries the marker.
 */
function findWrapperByMarker(ast: t.File, writeMarker: string): ReturnType<typeof findAllJSXElements>[number] | null {
  for (const match of findAllJSXElements(ast)) {
    if (wrapperMarkerValue(match.element) === writeMarker) return match;
  }
  return null;
}

/** The `data-hc-writeid` string value on `element`'s opening tag, or null if it carries none. Accepts
 *  BOTH the string-literal form (`data-hc-writeid="m"`) we write AND the expression-container form a
 *  formatter might rewrite it to (`data-hc-writeid={"m"}`, Opus), so the marker is never left
 *  un-strippable and committed. */
function wrapperMarkerValue(element: t.JSXElement): string | null {
  for (const attr of element.openingElement.attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name) || attr.name.name !== WRITE_MARKER_ATTR) continue;
    if (t.isStringLiteral(attr.value)) return attr.value.value;
    if (t.isJSXExpressionContainer(attr.value) && t.isStringLiteral(attr.value.expression)) {
      return attr.value.expression.value;
    }
  }
  return null;
}

/**
 * HYP-990 — surgical rollback keyed on the write-scoped marker (master spec §8.1 property 3). Removes
 * ONLY the `<div data-hc-writeid="<writeMarker>">` wrapper this write inserted, replacing it with its
 * wrapped element child, and leaves every unrelated edit in the file intact. Precise by construction
 * (the marker is unique), so — unlike {@link unwrapStyleWrapper} — it cannot mistake a pre-existing
 * identical user wrapper for ours.
 *  - `removed` — the marked wrapper was found and unwrapped (AST mutated).
 *  - `absent`  — no wrapper carries the marker (a concurrent edit removed it, or it was already
 *    stripped/kept). Nothing to write.
 */
export function unwrapByMarker(ast: t.File, writeMarker: string): 'removed' | 'absent' {
  const match = findWrapperByMarker(ast, writeMarker);
  if (!match) return 'absent';
  const child = match.element.children.find((c): c is t.JSXElement => t.isJSXElement(c));
  if (!child) {
    // The marked wrapper IS present but its element child is gone (an unreachable edge under the C1
    // lock — a formatter would have to turn `<Child/>` into a non-element). Report `absent` so the
    // caller does NOT claim a clean `removed`. The rollback then leaves the file UNTOUCHED and the
    // whole warn/rollback exit skips undo tracking (to protect any foreign formatter output) — so the
    // leftover is a transparent, not-visible wrapper, the documented lesser evil (see
    // `surgicallyRollBack`), NOT an undoable edit.
    return 'absent';
  }
  match.path.replaceWith(child);
  return 'removed';
}

/**
 * HYP-990 — on a VERIFIED-KEEP, strip the transient `data-hc-writeid` marker attribute from our
 * wrapper, leaving the clean `<div style={...}>` in committed source (the marker must never persist).
 *  - `stripped` — the marker attribute was found and removed (AST mutated).
 *  - `absent`   — no wrapper carries the marker (nothing to strip).
 */
export function stripWrapperMarker(ast: t.File, writeMarker: string): 'stripped' | 'absent' {
  const match = findWrapperByMarker(ast, writeMarker);
  if (!match) return 'absent';
  const opening = match.element.openingElement;
  const next = opening.attributes.filter(
    (attr) => !(t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === WRITE_MARKER_ATTR),
  );
  if (next.length === opening.attributes.length) return 'absent';
  opening.attributes = next;
  return 'stripped';
}

/**
 * HYP-990 (M2) anti-nesting — when the target element is ALREADY the sole child of one of our bare
 * `<div style={...}>` auto-wraps (a prior verified-keep, whose transient marker was stripped), a
 * second style edit must UPDATE that wrapper in place, never insert a SECOND wrapper around it
 * (master spec §9.1 "cannot nest wrappers"). Returns the enclosing wrapper element + its current
 * inline styles (captured for rollback) when the parent is exactly our shape, else null.
 *
 * "Our shape" (the whole safety argument for touching it in place): a `<div>` that MUST carry the
 * persistent `data-hc-autowrap` ownership marker, plus a `style={{…string-literals…}}` object and
 * (optionally) the transient `data-hc-writeid` marker — and NOTHING else — with the target as its
 * single meaningful child. The required ownership marker is what guarantees a user's own
 * `<div style={{…}}>` is never mistaken for ours.
 *
 * ACCEPTED RISK (Opus). Wrappers written by M1 (before this change added the ownership marker) are
 * bare `<div style>` with NO `data-hc-autowrap`, so they are indistinguishable from user JSX and are
 * NOT recognised here — a second edit on an M1-wrapped component nests a new marked wrapper inside the
 * M1 one. We deliberately do NOT loosen the gate to also match a bare single-child `<div style>`,
 * because that is exactly the user-div-mutation hazard the ownership marker closes; a nested
 * transparent wrapper is the lesser evil. Migration of pre-M2 wrappers is out of scope (HYP-1011).
 */
export function describeEnclosingAutoWrap(
  result: FindElementResult,
): { wrapper: t.JSXElement; priorStyles: Record<string, string> } | null {
  const parent = result.path.parent;
  if (!t.isJSXElement(parent) || jsxOpeningTagName(parent.openingElement.name) !== 'div') return null;

  const priorStyles = bareStyleWrapperStyles(parent.openingElement);
  if (!priorStyles) return null;

  const meaningful = parent.children.filter((c) => !(t.isJSXText(c) && c.value.trim() === ''));
  if (meaningful.length !== 1 || meaningful[0] !== result.element) return null;
  return { wrapper: parent, priorStyles };
}

/**
 * The inline `style` map of a `<div>` opening tag IFF it is one of OUR auto-wraps — it MUST carry the
 * persistent `data-hc-autowrap` ownership marker, plus a string-literal `style` object and
 * (optionally) the transient write marker, and nothing else. A user-authored `<div style={{…}}>`
 * (which never carries the ownership marker) returns null, so update-in-place never mutates a user's
 * own element (review, Opus/Fable).
 */
function bareStyleWrapperStyles(opening: t.JSXOpeningElement): Record<string, string> | null {
  let styleObj: t.ObjectExpression | null = null;
  let hasOwnerMarker = false;
  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) return null;
    if (attr.name.name === AUTOWRAP_OWNER_ATTR) {
      hasOwnerMarker = true;
      continue;
    }
    if (attr.name.name === WRITE_MARKER_ATTR) continue;
    if (attr.name.name !== 'style') return null;
    if (!t.isJSXExpressionContainer(attr.value) || !t.isObjectExpression(attr.value.expression)) return null;
    styleObj = attr.value.expression;
  }
  if (!hasOwnerMarker || !styleObj) return null;
  const styles: Record<string, string> = {};
  for (const prop of styleObj.properties) {
    if (!t.isObjectProperty(prop)) return null;
    const key = t.isIdentifier(prop.key) ? prop.key.name : t.isStringLiteral(prop.key) ? prop.key.value : null;
    if (key === null || !t.isStringLiteral(prop.value)) return null;
    styles[key] = prop.value.value;
  }
  return styles;
}

/**
 * HYP-990 (M2) — set an enclosing auto-wrap's inline `style` to `styles` and (re)stamp the
 * write-scoped `marker` on it, so the update-in-place path verifies through the same marker as a
 * fresh wrap. Mutates `wrapper` in place.
 */
export function updateExistingWrap(wrapper: t.JSXElement, styles: Record<string, string>, writeMarker: string): void {
  const opening = wrapper.openingElement;
  const nonStyleNonMarker = opening.attributes.filter(
    (attr) =>
      !(
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name) &&
        (attr.name.name === 'style' || attr.name.name === WRITE_MARKER_ATTR)
      ),
  );
  opening.attributes = [
    ...nonStyleNonMarker,
    t.jsxAttribute(t.jsxIdentifier(WRITE_MARKER_ATTR), t.stringLiteral(writeMarker)),
    t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(buildStyleObjectExpression(styles))),
  ];
}

/**
 * HYP-990 (M2) — rollback for the update-in-place path: restore the marked wrapper's inline `style`
 * to `priorStyles` and strip the transient marker (leaving the wrapper exactly as it was before this
 * edit). Marker-precise, so a pre-existing identical user wrapper is never touched.
 *  - `restored` — the marked wrapper was found and its style reverted.
 *  - `absent`   — no wrapper carries the marker (nothing to restore).
 */
export function restoreWrapStyleByMarker(
  ast: t.File,
  writeMarker: string,
  priorStyles: Record<string, string>,
): 'restored' | 'absent' {
  const match = findWrapperByMarker(ast, writeMarker);
  if (!match) return 'absent';
  updateExistingWrap(match.element, priorStyles, writeMarker);
  stripWrapperMarker(ast, writeMarker);
  return 'restored';
}

/**
 * HYP-990 (Opus) — STRUCTURAL fallback for the update-in-place rollback when the transient write
 * marker was dropped (e.g. a formatter). Finds the UNIQUE owned auto-wrap (`data-hc-autowrap`) whose
 * single meaningful child is a `childTag` element and restores its inline `style` to `priorStyles`,
 * stripping any leftover write marker. Keyed on the PERSISTENT ownership marker, so a user's own
 * `<div style>` is never touched; ambiguous (>1 match) or absent → `'absent'` (leave untouched, never
 * guess). Without this, a marker-dropped update-in-place rollback would leave the MERGED (new) styles
 * applied while the warning claims "could not apply" — an actually-applied, unremovable edit.
 */
export function restoreOwnedWrapStyle(
  ast: t.File,
  childTag: string,
  priorStyles: Record<string, string>,
): 'restored' | 'absent' {
  const matches = findAllJSXElements(ast).filter(({ element }) => isOwnedAutoWrapOf(element, childTag));
  if (matches.length !== 1) return 'absent';
  const wrapper = matches[0].element;
  const opening = wrapper.openingElement;
  // Keep the ownership marker, drop style + any leftover write marker, then set style to priorStyles.
  const kept = opening.attributes.filter(
    (attr) =>
      !(
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name) &&
        (attr.name.name === 'style' || attr.name.name === WRITE_MARKER_ATTR)
      ),
  );
  opening.attributes = [
    ...kept,
    t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(buildStyleObjectExpression(priorStyles))),
  ];
  return 'restored';
}

/** True when `element` is one of OUR owned auto-wraps (`data-hc-autowrap`) whose single meaningful
 *  child is a `childTag` element. */
function isOwnedAutoWrapOf(element: t.JSXElement, childTag: string): boolean {
  if (jsxOpeningTagName(element.openingElement.name) !== 'div') return false;
  const hasOwner = element.openingElement.attributes.some(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === AUTOWRAP_OWNER_ATTR,
  );
  if (!hasOwner) return false;
  const meaningful = element.children.filter((c) => !(t.isJSXText(c) && c.value.trim() === ''));
  if (meaningful.length !== 1) return false;
  const only = meaningful[0];
  return t.isJSXElement(only) && jsxOpeningTagName(only.openingElement.name) === childTag;
}

/**
 * SURGICAL rollback of {@link applyWrapCandidate} (HYP-987 P1, codex). Finds the exact wrapper
 * this module inserted — a `<div style={<our styles>}>` whose single JSX-element child's tag is
 * `childTag` — in `ast` and replaces it with that child, undoing ONLY the wrap.
 *
 * Why not a string-level restore-to-original: a formatter-on-save (or any concurrent edit) that
 * reformats the wrapped file makes the on-disk bytes differ from our exact generated output, so a
 * byte-for-byte content-CAS would misread the reformat as a foreign edit and leave the wrapper as
 * dead debris — the very thing the doctrine exists to prevent. Matching the wrapper by its
 * STRUCTURE (a `div` carrying exactly our style object, one element child of the right tag) removes
 * it regardless of reformatting AND preserves every unrelated edit elsewhere in the file (a true
 * surgical inverse hunk, master spec §8.1 property 3). Returns true when a wrapper was found and
 * unwrapped, false when none matched (already removed, or a concurrent edit changed it — in which
 * case the caller leaves the file untouched rather than guessing).
 */
/**
 * Outcome of {@link unwrapStyleWrapper}:
 *  - `removed`   — a unique matching wrapper was found and unwrapped (the AST was mutated).
 *  - `absent`    — NO matching wrapper exists (a concurrent edit already removed it, or it was
 *                  never present). The file is clean of our debris; nothing to write.
 *  - `ambiguous` — MORE THAN ONE identical wrapper matched; we cannot tell which this operation
 *                  created, so we do NOT unwrap. The wrapper may still be present (not clean).
 * The `absent` vs `ambiguous` distinction lets the caller tell a clean rollback (no leftover
 * wrapper) from an uncertain one (possible debris) — HYP-987 P1 (codex).
 */
export type UnwrapOutcome = 'removed' | 'absent' | 'ambiguous';

export function unwrapStyleWrapper(ast: t.File, styles: Record<string, string>, childTag: string): UnwrapOutcome {
  const matches = findAllJSXElements(ast).filter(({ element }) => isOurWrapperDiv(element, styles, childTag));
  if (matches.length === 0) return 'absent';
  if (matches.length > 1) return 'ambiguous';
  const { element, path } = matches[0];
  const child = element.children.find((c): c is t.JSXElement => t.isJSXElement(c));
  if (!child) return 'ambiguous';
  path.replaceWith(child);
  return 'removed';
}

/** True when `element` is exactly the `<div data-hc-autowrap style={styles}>` wrapper we inserted
 *  around a `childTag`. This is the STRUCTURAL fallback used only when the transient WRITE marker was
 *  dropped — but it MUST still require the persistent `data-hc-autowrap` OWNERSHIP marker (codex full
 *  panel): without that gate, a bare user-authored `<div style={sameStyles}><Widget/></div>` would
 *  match and be unwrapped, silently removing the user's own JSX. */
function isOurWrapperDiv(element: t.JSXElement, styles: Record<string, string>, childTag: string): boolean {
  const opening = element.openingElement;
  if (jsxOpeningTagName(opening.name) !== 'div') return false;
  let styleObj: t.ObjectExpression | null = null;
  let hasOwnerMarker = false;
  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) return false;
    if (attr.name.name === AUTOWRAP_OWNER_ATTR) {
      hasOwnerMarker = true;
      continue;
    }
    if (attr.name.name === WRITE_MARKER_ATTR) continue;
    if (attr.name.name !== 'style') return false;
    if (!t.isJSXExpressionContainer(attr.value) || !t.isObjectExpression(attr.value.expression)) return false;
    styleObj = attr.value.expression;
  }
  // The ownership marker is REQUIRED — never unwrap a user's own `<div style>` (codex full panel).
  if (!hasOwnerMarker || !styleObj || !styleObjectMatches(styleObj, styles)) return false;
  // ...wrapping EXACTLY the one element we wrapped, with no other meaningful children. HYP-987 P1
  // (codex): `applyWrapCandidate` only ever creates a single-element child, so a `<div style>` that
  // also holds text or an expression (`<div style={…}>KEEP ME<Card/></div>`) is NOT ours — unwrapping
  // it would silently delete that sibling content. Whitespace-only JSXText is ignored (formatting).
  const meaningful = element.children.filter((c) => !(t.isJSXText(c) && c.value.trim() === ''));
  if (meaningful.length !== 1) return false;
  const only = meaningful[0];
  if (!t.isJSXElement(only)) return false;
  return jsxOpeningTagName(only.openingElement.name) === childTag;
}

/** True when `objExpr`'s string-literal properties are exactly `styles` (same keys, same values). */
function styleObjectMatches(objExpr: t.ObjectExpression, styles: Record<string, string>): boolean {
  const keys = Object.keys(styles);
  if (objExpr.properties.length !== keys.length) return false;
  for (const prop of objExpr.properties) {
    if (!t.isObjectProperty(prop)) return false;
    const key = t.isIdentifier(prop.key) ? prop.key.name : t.isStringLiteral(prop.key) ? prop.key.value : null;
    if (key === null || !Object.prototype.hasOwnProperty.call(styles, key)) return false;
    if (!t.isStringLiteral(prop.value) || prop.value.value !== styles[key]) return false;
  }
  return true;
}

function buildStyleObjectExpression(styles: Record<string, string>): t.ObjectExpression {
  return t.objectExpression(
    Object.entries(styles).map(([property, value]) =>
      t.objectProperty(styleObjectKey(property), t.stringLiteral(value)),
    ),
  );
}

/**
 * A React inline-style key is normally a camelCase identifier (`backgroundColor`), but CSS custom
 * properties (`--brand`) and any non-identifier key are quoted string keys — `t.identifier('--brand')`
 * would emit invalid code (`{--brand: …}`). Quote whatever isn't a valid identifier.
 */
function styleObjectKey(property: string): t.Identifier | t.StringLiteral {
  return t.isValidIdentifier(property) ? t.identifier(property) : t.stringLiteral(property);
}
