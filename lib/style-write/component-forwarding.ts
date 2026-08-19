/**
 * @file Shared, channel-aware detection of whether a style-write TARGET forwards a SPECIFIC prop
 * (`style` / `className`) to a DOM element, or silently drops it.
 *
 * WHY SHARED (HYP-995 / parity rule): the style-write routing brain (StyleWritePlanner + the shared
 * executeStyleWriteRequest) is one implementation consumed by BOTH the VS Code extension and SaaS.
 * The write CHANNEL is chosen by the planner per property — a `className` (Tailwind) write needs the
 * component to forward `className`; an inline `style={{}}` write needs it to forward `style`. The
 * ORIGINAL forward-detector (HYP-901, ext-only `style-forwarding-check.ts`) was prop-AGNOSTIC — it
 * treated a component that forwards `className` OR `style` OR `...rest` as "forwards", period. So a
 * component that forwards `className` but NOT `style` (`function Card({ className, title, children })`)
 * was classified "forwards", and a dimensional edit (paddingLeft) routed to the inline-style adapter
 * wrote a DEAD `style={{ paddingLeft }}` prop the component never reads — DOM unchanged, no rollback,
 * no warning, plus a TypeScript error (`style` is not on `CardProps`). Fill/color edits, routing to
 * `className`, applied fine. The two paths diverged by ADAPTER (channel), not by component (HYP-995).
 *
 * This module answers the PRECISE question — "does <Tag>, as resolved from this call site, forward
 * prop P?" — so the executor can refuse a dead component-prop write BEFORE writing (both platforms),
 * and the extension can route that refusal into its M1 verify-and-retry / warn+rollback machinery.
 *
 * Resolution reuses `resolveMasterComponent` (the same import/alias/barrel resolution that backs
 * "Go to main component", HYP-563), so cross-file/imported components — the common case — are
 * covered, not just same-file declarations. Conservative by design: it reports a definite
 * `forwardsStyle:false` / `forwardsClassName:false` ONLY when the declaration was located and its
 * destructured props shape shows no such key and no rest spread. Everything unresolved (external
 * package, un-pinpointed barrel, parse failure, a non-destructured `props` param, class component,
 * unrecognised HOC) returns `kind:'unknown'` — false negatives are acceptable (runtime verify is the
 * arbiter), a false positive that refuses a genuinely-forwarding component's write is not.
 *
 * HYP-1235: the local monorepo workspace-package fallback (`node_modules` symlink → real `.ts(x)`
 * source, the "conloca" case) moved to the shared `lib/ast/workspace-package-entry.ts` — see that
 * module's header. `lib/style-read/forward-detect-locate.ts`'s `locateComponentDeclaration` (the A1
 * detector's own resolver, now also consumed by the ext's write-path pre-check,
 * `style-forwarding-check.ts`) uses the SAME shared fallback, so a workspace-package component
 * resolves identically through either path.
 */
import * as t from '@babel/types';
import type { FileIO } from '@lib/ast/file-io';
import { jsxNameFull, jsxNameRoot } from '@lib/ast/jsx-deps';
import { resolveMasterComponent } from '@lib/ast/master-component-resolver';
import { parseCode } from '@lib/ast/parser';
import { resolveWorkspacePackageEntry } from '@lib/ast/workspace-package-entry';

export interface ComponentForwardingInput {
  /** Parsed AST of the file containing the JSX usage (already parsed by the caller). */
  ast: t.File;
  /** Absolute path of the file containing the JSX usage. */
  filePath: string;
  /** The JSX element the style write is about to target. */
  element: t.JSXElement;
  fileIO: FileIO;
  /** tsconfig path-alias map for `filePath`'s project (empty/absent = relative-only resolution). */
  aliasMap?: Record<string, string>;
}

/**
 * `native` — a host DOM tag (lowercase) that forwards every prop trivially.
 * `unknown` — a custom component we could not resolve/inspect statically. Treated as "forwards" by
 *   {@link forwardsProp} so a write is never refused on a guess (runtime verify is the arbiter).
 * `custom` — a resolved custom component with a per-prop forwarding verdict.
 */
export type ComponentForwardingFacts =
  | { kind: 'native' }
  | { kind: 'unknown' }
  | {
      kind: 'custom';
      /** Display name (dotted for member tags: `Foo.Bar`) for the warning / AI-fix diagnosis. */
      displayName: string;
      /** Where the component is DEFINED (1-based line), when the resolver pinpointed it. */
      definition?: { filePath: string; line: number };
      /** Destructures `style` in its first param. */
      forwardsStyle: boolean;
      /** Destructures `className` in its first param. */
      forwardsClassName: boolean;
      /** Spreads `...rest` in its first param — forwards ANY prop, so both `style` and `className`. */
      forwardsRest: boolean;
    };

/**
 * Resolve `element`'s tag to a component declaration (same-file or imported) and report whether it
 * forwards `style`/`className`/rest to the DOM. See the file header for the conservative contract.
 */
export async function resolveComponentForwarding(input: ComponentForwardingInput): Promise<ComponentForwardingFacts> {
  const tagName = jsxNameRoot(input.element.openingElement.name);
  if (!tagName || !isCustomComponentTag(tagName)) return { kind: 'native' };

  const aliasMap = input.aliasMap ?? {};
  let located = await locateComponentParams(input, tagName, aliasMap);
  if (!located) {
    // HYP-995 — the tag resolved to `external`/unresolved. If it's actually a LOCAL monorepo workspace
    // package (`@conloca-mini/ui`, a node_modules symlink whose package.json entry is a `.ts(x)` SOURCE
    // file), inspect it too: the conloca repro (CardProps = { title; children }) is exactly this case, and
    // without resolving it the dead `style` prop + TS error is never caught. Resolve the package's entry,
    // then re-run resolution with a synthetic alias so the existing barrel-following finds the component.
    const workspace = await resolveWorkspacePackageEntry(input, tagName);
    if (workspace) {
      located = await locateComponentParams(input, tagName, {
        ...aliasMap,
        [workspace.specifier]: workspace.entryBase,
      });
    }
  }
  if (!located) return { kind: 'unknown' };

  const forwarding = analyzeParamForwarding(located.params);
  return {
    kind: 'custom',
    displayName: jsxNameFull(input.element.openingElement.name),
    ...(located.definition ? { definition: located.definition } : {}),
    ...forwarding,
  };
}

/**
 * True when `facts` indicates the component forwards `prop` (`style` or `className`) to the DOM.
 * `native` and `unknown` both return true — never refuse a write on a host element or an
 * unresolved guess (fail-open on uncertainty; the runtime verify is the arbiter for `unknown`).
 * A `...rest` spread forwards any prop. Only a resolved `custom` component with a definite
 * missing-prop-and-no-rest verdict returns false.
 */
export function forwardsProp(facts: ComponentForwardingFacts, prop: 'style' | 'className'): boolean {
  if (facts.kind !== 'custom') return true;
  if (facts.forwardsRest) return true;
  return prop === 'style' ? facts.forwardsStyle : facts.forwardsClassName;
}

/** A JSX tag is a custom component when its (leftmost) name starts with an uppercase letter. */
function isCustomComponentTag(tagName: string): boolean {
  return /^[A-Z]/.test(tagName);
}

interface ParamForwarding {
  forwardsStyle: boolean;
  forwardsClassName: boolean;
  forwardsRest: boolean;
}

/**
 * Inspect a component's first param and report per-prop forwarding. A destructured object pattern is
 * read key-by-key. Zero params can never read a prop → forwards nothing. Any NON-destructuring shape
 * (a plain `props` identifier, a non-object pattern) is an UNKNOWN shape, not a positive "doesn't
 * forward" signal — report all-true so a write is never refused on it (stay conservative; false
 * positives that block a real forwarder are the cost to avoid).
 */
function analyzeParamForwarding(params: t.Node[]): ParamForwarding {
  const first = params[0];
  if (!first) return { forwardsStyle: false, forwardsClassName: false, forwardsRest: false };
  const pattern = t.isAssignmentPattern(first) ? first.left : first;
  if (!t.isObjectPattern(pattern)) return { forwardsStyle: true, forwardsClassName: true, forwardsRest: true };

  let forwardsStyle = false;
  let forwardsClassName = false;
  let forwardsRest = false;
  for (const prop of pattern.properties) {
    if (t.isRestElement(prop)) {
      forwardsRest = true;
    } else if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
      if (prop.key.name === 'style') forwardsStyle = true;
      if (prop.key.name === 'className') forwardsClassName = true;
    }
  }
  return { forwardsStyle, forwardsClassName, forwardsRest };
}

/** The outer function params of `tagName`'s resolved declaration, plus its DEFINITION location. */
interface LocatedComponent {
  params: t.Node[];
  definition?: { filePath: string; line: number };
}

/** Resolve `tagName`'s declaration (same-file or imported) and return its outer function's params. */
async function locateComponentParams(
  input: ComponentForwardingInput,
  tagName: string,
  aliasMap: Record<string, string>,
): Promise<LocatedComponent | null> {
  let importerSource: string;
  try {
    importerSource = await input.fileIO.readFile(input.filePath);
  } catch {
    return null;
  }

  const resolution = await resolveMasterComponent({
    importerFilePath: input.filePath,
    importerSource,
    componentName: tagName,
    fileIO: input.fileIO,
    aliasMap,
  });

  if (resolution.kind === 'inline') {
    const found = findComponentParams(input.ast, { kind: 'byName', name: tagName });
    if (!found) return null;
    return {
      params: found.params,
      ...(found.line !== null ? { definition: { filePath: input.filePath, line: found.line } } : {}),
    };
  }
  if (resolution.kind !== 'local' || !resolution.pinpointed) {
    // 'host' (shouldn't reach here), 'external', 'not-found', or a barrel landing that
    // didn't pinpoint the symbol — nothing we can safely inspect.
    return null;
  }

  try {
    const targetSource =
      resolution.filePath === input.filePath ? importerSource : await input.fileIO.readFile(resolution.filePath);
    const targetAst = parseCode(targetSource);
    const found = findComponentParams(targetAst, {
      kind: 'byLocation',
      line: resolution.line,
      column: resolution.column,
      name: resolution.componentName || null,
    });
    if (!found) return null;
    return { params: found.params, definition: { filePath: resolution.filePath, line: resolution.line } };
  } catch {
    return null;
  }
}

/**
 * `byName` — same-file inline component, matched by its identifier.
 * `byLocation` — a resolved import. HYP-987 P1 #7: matching by LINE ALONE false-positives when two
 *   declarations share a line (`export const Forward = …, Drop = …`) — importing `Drop` would inspect
 *   `Forward`'s params. So match by the resolver's own `componentName` when named (unique in top-level
 *   file scope), and require line + column otherwise (the pinpointed column disambiguates same-line,
 *   anonymous default-export declarators).
 */
type ComponentDeclMatch =
  | { kind: 'byLocation'; line: number; column: number; name: string | null }
  | { kind: 'byName'; name: string };

/** A matched top-level component declaration: its outer function params and its 1-based declaration line. */
interface MatchedDeclaration {
  params: t.Node[];
  line: number | null;
}

function findComponentParams(ast: t.File, match: ComponentDeclMatch): MatchedDeclaration | null {
  for (const node of ast.program.body) {
    const found = paramsFromTopLevelStatement(node, match);
    if (found) return found;
  }
  return null;
}

function paramsFromTopLevelStatement(node: t.Statement, match: ComponentDeclMatch): MatchedDeclaration | null {
  if (t.isExportDefaultDeclaration(node)) return paramsFromDeclarationLike(node.declaration, match, node.loc);
  if (t.isExportNamedDeclaration(node) && node.declaration) {
    return paramsFromDeclarationLike(node.declaration, match, node.loc);
  }
  return paramsFromDeclarationLike(node, match);
}

function paramsFromDeclarationLike(
  node: t.Node | null | undefined,
  match: ComponentDeclMatch,
  fallbackLoc?: t.SourceLocation | null,
): MatchedDeclaration | null {
  if (!node) return null;

  if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
    if (!declMatches(node, node.type === 'FunctionDeclaration' ? node.id?.name : undefined, match, fallbackLoc)) {
      return null;
    }
    return { params: node.params, line: (node.loc ?? fallbackLoc)?.start.line ?? null };
  }
  if (t.isVariableDeclaration(node)) {
    for (const d of node.declarations) {
      if (!t.isIdentifier(d.id) || !declMatches(d, d.id.name, match, fallbackLoc)) continue;
      const fn = unwrapToFunction(d.init);
      if (fn) return { params: fn.params, line: (d.loc ?? node.loc ?? fallbackLoc)?.start.line ?? null };
    }
  }
  return null;
}

function declMatches(
  node: t.Node,
  name: string | null | undefined,
  match: ComponentDeclMatch,
  fallbackLoc?: t.SourceLocation | null,
): boolean {
  if (match.kind === 'byName') return name === match.name;

  const loc = node.loc ?? fallbackLoc;
  if (!loc || loc.start.line !== match.line) return false;
  if (match.name && name && name === match.name) return true;
  // Names diverge (aliased export) OR one side is anonymous (default export). Fall back to the
  // resolver's pinpointed column, which still disambiguates same-line declarators.
  return loc.start.column === match.column;
}

/**
 * The ONLY call wrappers transparent w.r.t. prop forwarding — a `memo(fn)` / `forwardRef(fn)`
 * component forwards exactly what `fn` forwards. Any OTHER call (a styled-components factory, a custom
 * HOC) is NOT transparent: its argument is a config/render callback, not the props destructure, so
 * inspecting it would misread the shape. Those return `unknown` (a null param list) instead.
 */
const TRANSPARENT_HOC_NAMES: ReadonlySet<string> = new Set(['memo', 'forwardRef']);

function isTransparentHocCallee(callee: t.Expression | t.V8IntrinsicIdentifier): boolean {
  if (t.isIdentifier(callee)) return TRANSPARENT_HOC_NAMES.has(callee.name);
  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)) {
    return TRANSPARENT_HOC_NAMES.has(callee.property.name);
  }
  return false;
}

/** Unwrap `forwardRef(fn)` / `memo(fn)` / nested combinations down to the actual function node. */
function unwrapToFunction(node: t.Node | null | undefined): t.FunctionExpression | t.ArrowFunctionExpression | null {
  if (!node) return null;
  if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) return node;
  if (t.isCallExpression(node) && isTransparentHocCallee(node.callee) && node.arguments.length > 0) {
    return unwrapToFunction(node.arguments[0] as t.Node);
  }
  return null;
}

// The workspace-package resolution helpers (`resolveWorkspaceEntryBase` and its traversal-guard
// internals) moved to the shared `lib/ast/workspace-package-entry.ts` (HYP-1235) — see this file's
// header and that module's own doc comment.
