/**
 * @file HYP-901 — static, best-effort check for whether a style-write TARGET is a custom
 * component that forwards `style`/`className` to a DOM element, vs one that silently drops it.
 *
 * Accessed via: ast-update-utils.ts's `updateStyles`, called BEFORE the write (this is the A1
 * "forward-detector" pre-write capability check, master spec docs/specs/2026-06-12-styles-system-
 * master-spec.md §9.2a — "a high-confidence NEGATIVE is a pre-write EXCLUSION: the planner skips
 * that channel before writing, so a swallowing <Button> never gets a blind inline write").
 *
 * History: originally written as a POST-write, warn-only check (HYP-901 first pass) — apply the
 * style onto the custom component regardless, then tell the user it might not have worked. Alex
 * rejected that shape (tg#6243): the master spec already covers this exact situation and requires
 * verify-then-retry, not warn-and-give-up. This module now answers the PRE-write question so the
 * caller can choose a different candidate (see style-wrap-retry.ts) instead of writing dead code
 * into a prop the component never reads. The original repro (HostRoutePage.tsx from conloca-app —
 * a layout wrapper with no `style` prop and no `...rest` spread) is the canonical `not-forwarding`
 * case this module was built against.
 *
 * Assumptions: reuses `resolveMasterComponent` (lib/ast/master-component-resolver) — the same
 * import/alias/barrel resolution that backs "Go to main component" (HYP-563) — so cross-file
 * components (imported from another file, the common case) are covered, not just same-file
 * declarations. Conservative by design: returns `not-forwarding` ONLY when a component's
 * declaration was actually located and its destructured props shape shows no `style`, no
 * `className`, and no rest spread. Everything unresolved (external package, barrel we can't
 * pinpoint, parse failure, non-destructured `props` param, class component, HOC-wrapped
 * component) returns `unknown` — false negatives are acceptable, false positives on a component
 * that DOES forward the prop are not (would auto-wrap or warn on a perfectly fine target).
 */

import * as t from '@babel/types';
import type { FileIO } from '@lib/ast/file-io';
import { resolveMasterComponent } from '@lib/ast/master-component-resolver';
import { parseCode } from '@lib/ast/parser';
import { describeJsxName, jsxOpeningTagName } from './ast-utils';

export interface StyleForwardCheckInput {
  /** Parsed AST of the file containing the JSX usage (already parsed by the caller). */
  ast: t.File;
  /** Absolute path of the file containing the JSX usage. */
  filePath: string;
  /** The JSX element the style write is about to target. */
  element: t.JSXElement;
  fileIO: FileIO;
  /** tsconfig path-alias map for `filePath`'s project (empty map = relative-only resolution). */
  aliasMap: Record<string, string>;
}

/**
 * `forwards` — the tag is a native DOM element, OR a custom component proven to forward
 *   `style`/`className` (or unresolvable-but-not-excluded... no: unresolvable is `unknown`).
 * `not-forwarding` — a custom component whose declaration was located and clearly does NOT
 *   forward `style`/`className` — a pre-write EXCLUSION (§9.2a). Carries the display name for
 *   the wrap-candidate and, if that also fails, the last-resort warning.
 * `unknown` — can't tell statically (external package, unresolved barrel, parse failure, a
 *   plain non-destructured `props` param, …). Admitted as a normal write candidate — B1 runtime
 *   verify (when available) is the arbiter, not this static check.
 */
export type StyleForwardCheckResult =
  | { kind: 'forwards' }
  | { kind: 'unknown' }
  | { kind: 'not-forwarding'; displayName: string };

export async function checkStyleForwarding(input: StyleForwardCheckInput): Promise<StyleForwardCheckResult> {
  const tagName = jsxOpeningTagName(input.element.openingElement.name);
  if (!tagName || !isCustomComponentTag(tagName)) return { kind: 'forwards' };

  const params = await locateComponentParams(input, tagName);
  if (!params) return { kind: 'unknown' };
  if (componentForwardsStyleProps(params)) return { kind: 'forwards' };

  return { kind: 'not-forwarding', displayName: describeJsxName(input.element) };
}

/** Human-facing last-resort message — used only once every retry candidate is exhausted. */
export function buildNonForwardingWarningMessage(displayName: string): string {
  return (
    `Style change could not be applied — the custom component (\`<${displayName}>\`) doesn't forward this ` +
    `prop to the DOM and no safe wrapper could be inserted automatically. Consider targeting a native DOM ` +
    `element instead.`
  );
}

function isCustomComponentTag(tagName: string): boolean {
  return /^[A-Z]/.test(tagName);
}

/** Resolve `tagName`'s declaration (same-file or imported) and return its outer function's params. */
async function locateComponentParams(input: StyleForwardCheckInput, tagName: string): Promise<t.Node[] | null> {
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
    aliasMap: input.aliasMap,
  });

  if (resolution.kind === 'inline') {
    return findComponentParams(input.ast, { kind: 'byName', name: tagName });
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
    return findComponentParams(targetAst, {
      kind: 'byLocation',
      line: resolution.line,
      column: resolution.column,
      name: resolution.componentName || null,
    });
  } catch {
    return null;
  }
}

/**
 * `byName` — same-file inline component, matched by its identifier.
 * `byLocation` — a resolved import. HYP-987 P1 #7: matching by LINE ALONE false-positives when
 *   two declarations share a line (`export const Forward = …, Drop = …`) — importing `Drop`
 *   would inspect `Forward`'s params and mis-classify. So match by the resolver's own
 *   `componentName` when the declaration is named (unique in top-level file scope), and require
 *   line + column otherwise. `resolveMasterComponent` pinpoints the specific declarator's
 *   line/column, so the column disambiguates same-line, anonymous (default-export) declarations.
 */
type ComponentDeclMatch =
  | { kind: 'byLocation'; line: number; column: number; name: string | null }
  | { kind: 'byName'; name: string };

/** Find a top-level component declaration's function params, by name (same-file) or by line (resolved import). */
function findComponentParams(ast: t.File, match: ComponentDeclMatch): t.Node[] | null {
  for (const node of ast.program.body) {
    const params = paramsFromTopLevelStatement(node, match);
    if (params) return params;
  }
  return null;
}

function paramsFromTopLevelStatement(node: t.Statement, match: ComponentDeclMatch): t.Node[] | null {
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
): t.Node[] | null {
  if (!node) return null;

  if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
    return declMatches(node, node.type === 'FunctionDeclaration' ? node.id?.name : undefined, match, fallbackLoc)
      ? node.params
      : null;
  }
  if (t.isVariableDeclaration(node)) {
    for (const d of node.declarations) {
      if (!t.isIdentifier(d.id) || !declMatches(d, d.id.name, match, fallbackLoc)) continue;
      const fn = unwrapToFunction(d.init);
      if (fn) return fn.params;
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

  // HYP-987 P1 #7 — a named declaration is uniquely identified by its name in top-level file
  // scope, so the resolver's name + line pins the target and a same-line sibling
  // (`export const Forward = …, Drop = …`) can never be mistaken for it.
  const loc = node.loc ?? fallbackLoc;
  if (!loc || loc.start.line !== match.line) return false;
  if (match.name && name && name === match.name) return true;
  // Names diverge (an aliased export — `export { Button as Btn }` — where the resolver reports the
  // import-site name while the declaration keeps its own) OR one side is anonymous (a default
  // export). Fall back to the resolver's pinpointed column, which still disambiguates same-line
  // declarators (they have distinct columns) without over-rejecting a genuinely-forwarding alias.
  return loc.start.column === match.column;
}

/**
 * The ONLY call wrappers that are transparent w.r.t. prop forwarding — a `memo(fn)` / `forwardRef(fn)`
 * component forwards exactly what `fn` forwards. Any OTHER call (a styled-components factory
 * `styled.button(({ theme }) => …)`, `observer(…)`, a custom HOC) is NOT transparent: its argument
 * is a config/render callback, not the component's own props destructure, so inspecting that
 * argument's params would misread e.g. `styled.button`'s `{ theme }` as the props shape and wrongly
 * flag a forwarding component as `not-forwarding`. We return `unknown` (via a null param list) for
 * those instead — the runtime verify is the arbiter, not this static check.
 */
const TRANSPARENT_HOC_NAMES: ReadonlySet<string> = new Set(['memo', 'forwardRef']);

function isTransparentHocCallee(callee: t.Expression | t.V8IntrinsicIdentifier): boolean {
  if (t.isIdentifier(callee)) return TRANSPARENT_HOC_NAMES.has(callee.name);
  // `React.memo` / `React.forwardRef` — match on the member name, any namespace object.
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

/**
 * True when the component's first param is a destructured props object that lists
 * `style`/`className` or spreads the rest (`...rest`). A component with zero params can
 * never read a prop, so it's treated as non-forwarding too. Any other param shape (a
 * plain `props` identifier, a non-destructuring pattern) is UNKNOWN, not a positive
 * "doesn't forward" signal — returns true (stay conservative) to avoid false positives.
 */
function componentForwardsStyleProps(params: t.Node[]): boolean {
  const first = params[0];
  if (!first) return false;
  const pattern = t.isAssignmentPattern(first) ? first.left : first;
  if (!t.isObjectPattern(pattern)) return true;
  return pattern.properties.some(isStyleOrRestProperty);
}

function isStyleOrRestProperty(prop: t.ObjectPattern['properties'][number]): boolean {
  if (t.isRestElement(prop)) return true;
  return (
    t.isObjectProperty(prop) && t.isIdentifier(prop.key) && (prop.key.name === 'style' || prop.key.name === 'className')
  );
}
