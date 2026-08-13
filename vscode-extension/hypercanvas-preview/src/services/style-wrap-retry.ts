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
 * Wrap `result`'s element in a transparent `<div style={...}>`, mutating the AST in place. Wraps
 * a CLONE of the original node (not the node object itself — see the file header for why) and
 * builds the `style` object directly rather than through the generic JSON-round-trip attribute
 * builder. Caller is responsible for re-printing/writing the AST and for having already checked
 * {@link isWrapEligible} + {@link hasOnlyVisualProperties}.
 */
export function applyWrapCandidate(result: FindElementResult, styles: Record<string, string>): boolean {
  const styleAttr = t.jsxAttribute(
    t.jsxIdentifier('style'),
    t.jsxExpressionContainer(buildStyleObjectExpression(styles)),
  );
  // withoutLoc: true — a clone that KEEPS the original's position range still makes recast
  // treat it as "reuse these original source bytes", which is exactly the stale-splice bug this
  // function exists to avoid (see file header). Stripping loc forces a full fresh reprint.
  const clonedElement = t.cloneNode(result.element, true, true) as t.JSXElement;
  const wrapper = t.jsxElement(
    t.jsxOpeningElement(t.jsxIdentifier('div'), [styleAttr]),
    t.jsxClosingElement(t.jsxIdentifier('div')),
    [clonedElement],
    false,
  );
  result.path.replaceWith(wrapper);
  return true;
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

/** True when `element` is exactly the `<div style={styles}>` wrapper we inserted around a `childTag`. */
function isOurWrapperDiv(element: t.JSXElement, styles: Record<string, string>, childTag: string): boolean {
  const opening = element.openingElement;
  if (jsxOpeningTagName(opening.name) !== 'div') return false;
  // Our wrapper carries exactly one attribute: the style object.
  if (opening.attributes.length !== 1) return false;
  const attr = opening.attributes[0];
  if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name) || attr.name.name !== 'style') return false;
  if (!t.isJSXExpressionContainer(attr.value) || !t.isObjectExpression(attr.value.expression)) return false;
  if (!styleObjectMatches(attr.value.expression, styles)) return false;
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
