/**
 * @file A1 forward-detector — component declaration location (HYP-1229).
 *
 * Resolves a JSX tag name to its declaration (same-file or imported, via `resolveMasterComponent`
 * — the same import/alias/barrel resolution "Go to main component" HYP-563 uses) and classifies
 * what kind of declaration it is: a plain function component, a `memo`/`forwardRef`-wrapped one,
 * or a styled-components factory (`styled.tag(...)` / `styled(Component)(...)`, a known library
 * contract rather than user render code to trace).
 *
 * Ported from (and functionally a superset of) the HYP-901 `checkStyleForwarding`'s original
 * private `locateComponentParams`/`findComponentParams` in
 * `vscode-extension/hypercanvas-preview/src/services/style-forwarding-check.ts`. HYP-1235 rewired
 * that file onto `detectForwarding` (`forward-detect.ts`), which resolves declarations through
 * THIS module — so `style-forwarding-check.ts` now imports `locateComponentDeclaration` directly
 * (for its `not-forwarding` definition pinpoint) rather than keeping its own copy. Its HYP-901/
 * HYP-987 regression tests were updated in the same change to match the richer per-channel
 * detection (e.g. a styled-components factory is now a confident POSITIVE, not `unknown`).
 *
 * `lib/style-write/component-forwarding.ts` (consumed by the shared executor's HYP-995
 * channel-precise write refusal, NOT by the ext's pre-write gate above) still keeps its OWN
 * separate per-prop analysis, but the LOCATION-resolution fallback for local monorepo workspace
 * packages (a `node_modules` symlink whose `package.json` entry is real `.ts(x)` source — the
 * "conloca" case, HYP-995) is now SHARED: both this module and `component-forwarding.ts` call
 * `resolveWorkspacePackageEntry` (`lib/ast/workspace-package-entry.ts`). A 3-model `review diff`
 * round on HYP-1235 independently caught that this module lacked the fallback when it was first
 * wired as the ext's write-path pre-check's sole resolver — a workspace-package component would
 * have silently degraded from a real verdict to `unknown` on that path alone. If you fix a
 * resolution bug in the non-workspace part of this file, port the same fix to
 * `component-forwarding.ts`'s `locateComponentParams` (and vice versa) — those two still don't
 * share code, only the workspace-entry fallback does.
 */
import * as t from '@babel/types';
import type { FileIO } from '../ast/file-io';
import { resolveMasterComponent } from '../ast/master-component-resolver';
import { parseCode } from '../ast/parser';
import { resolveWorkspacePackageEntry } from '../ast/workspace-package-entry';

export interface LocatedComponent {
  /** Null when the declaration is a styled-components factory, or an unresolvable shape. */
  fnNode: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | null;
  styledComponentsFactory: boolean;
  /** Set only when `styledComponentsFactory` and the wrap target is a custom (non-host) component. */
  styledWrapsComponentTag?: string;
  /** The AST of the file the declaration itself lives in. Consumed by `forward-detect.ts`'s
   *  `outcomeForStyledFactory` (HYP-1234) as the entry point for the bounded one-level
   *  `styled(WrappedComponent)` resolution — paired with `declarationFilePath` below to locate
   *  the wrapped component from the FILE that references it, not the original call site's file. */
  fileAst: t.File;
  componentName: string;
  declarationFilePath: string;
  /**
   * 1-based declaration line, best-effort. NOT simply `fnNode?.loc?.start.line` — recast (the
   * parser `../ast/parser.ts` wraps) strips `.loc` from an inner `FunctionDeclaration` when it's
   * the `declaration` of an `export default function Foo() {}` statement (a real, reproduced
   * recast quirk: the OUTER `ExportDefaultDeclaration` keeps its `.loc`, the inner node doesn't).
   * Computed the same way the original HYP-901 `checkStyleForwarding` did — the declarator's own
   * loc, falling back to the enclosing export statement's loc — so it stays accurate for both
   * `export default function Foo() {}` and a same-line multi-declarator `export const A = ..., B
   * = ...;`. Null only when neither the declarator nor the enclosing statement carries a loc.
   */
  definitionLine: number | null;
}

export interface LocateInput {
  ast: t.File;
  filePath: string;
  fileIO: FileIO;
  aliasMap: Record<string, string>;
}

export async function locateComponentDeclaration(
  input: LocateInput,
  tagName: string,
): Promise<LocatedComponent | null> {
  let importerSource: string;
  try {
    importerSource = await input.fileIO.readFile(input.filePath);
  } catch {
    return null;
  }

  const located = await resolveWithAliasMap(input, tagName, importerSource, input.aliasMap);
  if (located) return located;

  // The tag resolved to `external`/unresolved under the caller's own aliasMap. If it's actually a
  // LOCAL monorepo workspace package (a `node_modules` symlink whose `package.json` entry is a
  // `.ts(x)` SOURCE file), inspect it too — see `resolveWorkspacePackageEntry`'s doc comment (ported
  // from `component-forwarding.ts`'s HYP-995 fallback). Resolve the package's entry, then re-run
  // resolution with a synthetic alias so the existing barrel-following finds the component.
  const workspace = await resolveWorkspacePackageEntry(input, tagName);
  if (!workspace) return null;
  return resolveWithAliasMap(input, tagName, importerSource, {
    ...input.aliasMap,
    [workspace.specifier]: workspace.entryBase,
  });
}

/** Resolve `tagName`'s declaration under a SPECIFIC aliasMap — factored out so
 *  {@link locateComponentDeclaration} can retry with a workspace-package synthetic alias without
 *  re-reading `input.filePath` a second time. */
async function resolveWithAliasMap(
  input: LocateInput,
  tagName: string,
  importerSource: string,
  aliasMap: Record<string, string>,
): Promise<LocatedComponent | null> {
  const resolution = await resolveMasterComponent({
    importerFilePath: input.filePath,
    importerSource,
    componentName: tagName,
    fileIO: input.fileIO,
    aliasMap,
  });

  if (resolution.kind === 'inline') {
    return findDeclaration(input.ast, { kind: 'byName', name: tagName }, input.filePath, tagName);
  }
  if (resolution.kind !== 'local' || !resolution.pinpointed) return null;

  try {
    const targetSource =
      resolution.filePath === input.filePath ? importerSource : await input.fileIO.readFile(resolution.filePath);
    const targetAst = parseCode(targetSource);
    return findDeclaration(
      targetAst,
      { kind: 'byLocation', line: resolution.line, column: resolution.column, name: resolution.componentName || null },
      resolution.filePath,
      resolution.componentName || tagName,
    );
  } catch {
    return null;
  }
}

/** Same disambiguation as HYP-987 P1 #7 (`component-forwarding.ts`'s own `ComponentDeclMatch`) — a
 *  same-line multi-declarator export (`export const Forward = …, Drop = …`) must be matched by the
 *  resolver's own pinpointed name/column, never by line alone. */
type ComponentDeclMatch =
  | { kind: 'byLocation'; line: number; column: number; name: string | null }
  | { kind: 'byName'; name: string };

function findDeclaration(
  ast: t.File,
  match: ComponentDeclMatch,
  filePath: string,
  componentName: string,
): LocatedComponent | null {
  for (const node of ast.program.body) {
    const located = fromTopLevelStatement(node, match, ast, filePath, componentName);
    if (located) return located;
  }
  return null;
}

function fromTopLevelStatement(
  node: t.Statement,
  match: ComponentDeclMatch,
  fileAst: t.File,
  filePath: string,
  componentName: string,
): LocatedComponent | null {
  if (t.isExportDefaultDeclaration(node)) {
    return fromDeclarationLike(node.declaration, match, fileAst, filePath, componentName, node.loc);
  }
  if (t.isExportNamedDeclaration(node) && node.declaration) {
    return fromDeclarationLike(node.declaration, match, fileAst, filePath, componentName, node.loc);
  }
  return fromDeclarationLike(node, match, fileAst, filePath, componentName);
}

function fromDeclarationLike(
  node: t.Node | null | undefined,
  match: ComponentDeclMatch,
  fileAst: t.File,
  filePath: string,
  componentName: string,
  fallbackLoc?: t.SourceLocation | null,
): LocatedComponent | null {
  if (!node) return null;

  if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
    const name = node.type === 'FunctionDeclaration' ? node.id?.name : undefined;
    if (!declMatches(node, name, match, fallbackLoc)) return null;
    // See `LocatedComponent.definitionLine`'s doc comment — `node.loc` can be null here (recast
    // strips it from an `export default function`'s inner declaration) even though the caller's
    // `fallbackLoc` (the enclosing export statement) is populated.
    const definitionLine = (node.loc ?? fallbackLoc)?.start.line ?? null;
    return {
      fnNode: node,
      styledComponentsFactory: false,
      fileAst,
      componentName,
      declarationFilePath: filePath,
      definitionLine,
    };
  }
  if (t.isVariableDeclaration(node)) {
    for (const d of node.declarations) {
      if (!t.isIdentifier(d.id) || !declMatches(d, d.id.name, match, fallbackLoc)) continue;
      const definitionLine = (d.loc ?? node.loc ?? fallbackLoc)?.start.line ?? null;
      return fromVariableInit(d.init, fileAst, filePath, componentName, definitionLine);
    }
  }
  return null;
}

function fromVariableInit(
  init: t.Expression | null | undefined,
  fileAst: t.File,
  filePath: string,
  componentName: string,
  definitionLine: number | null,
): LocatedComponent | null {
  const styled = classifyStyledComponentsExpression(init);
  if (styled.matched) {
    return {
      fnNode: null,
      styledComponentsFactory: true,
      styledWrapsComponentTag: styled.wrapsComponentTag ?? undefined,
      fileAst,
      componentName,
      definitionLine,
      declarationFilePath: filePath,
    };
  }
  const fn = unwrapToFunction(init);
  return fn
    ? { fnNode: fn, styledComponentsFactory: false, fileAst, componentName, declarationFilePath: filePath, definitionLine }
    : null;
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
  return loc.start.column === match.column;
}

/** Only `memo`/`forwardRef` are transparent w.r.t. prop forwarding — any OTHER call (a
 *  styled-components factory, a custom HOC) is NOT transparent: its argument is a config/render
 *  callback, not the props destructure, so inspecting it would misread the shape. */
const TRANSPARENT_HOC_NAMES: ReadonlySet<string> = new Set(['memo', 'forwardRef']);

function isTransparentHocCallee(callee: t.Expression | t.V8IntrinsicIdentifier): boolean {
  if (t.isIdentifier(callee)) return TRANSPARENT_HOC_NAMES.has(callee.name);
  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)) {
    return TRANSPARENT_HOC_NAMES.has(callee.property.name);
  }
  return false;
}

function unwrapToFunction(node: t.Node | null | undefined): t.FunctionExpression | t.ArrowFunctionExpression | null {
  if (!node) return null;
  if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) return node;
  if (t.isCallExpression(node) && isTransparentHocCallee(node.callee) && node.arguments.length > 0) {
    return unwrapToFunction(node.arguments[0] as t.Node);
  }
  return null;
}

interface StyledClassification {
  matched: boolean;
  /** The wrapped component's tag name, set only for `styled(UppercaseIdentifier)`. */
  wrapsComponentTag?: string | null;
}

/**
 * Recognizes `styled.tag(...)`, `` styled.tag`...` ``, `styled(Component)(...)`, and
 * `` styled(Component)`...` `` — both the call-style and tagged-template-style styled-components
 * APIs. `styled.tag` always injects its generated className onto a real DOM node (a known library
 * contract); `styled(Component)` only holds that guarantee if `Component` itself forwards, hence
 * `wrapsComponentTag` — see forward-detect.ts's bounded ONE-LEVEL recursive handling of it
 * (HYP-1234): it traces the wrapped component once, never a second wrap deep.
 */
export function classifyStyledComponentsExpression(node: t.Node | null | undefined): StyledClassification {
  if (!node) return { matched: false };
  if (t.isTaggedTemplateExpression(node)) return classifyStyledCallee(node.tag);
  if (t.isCallExpression(node)) {
    const calleeClass = classifyStyledCallee(node.callee);
    if (calleeClass.matched) return calleeClass;
    return classifyStyledComponentsExpression(node.callee as t.Node);
  }
  return { matched: false };
}

function classifyStyledCallee(expr: t.Node): StyledClassification {
  if (t.isMemberExpression(expr) && !expr.computed && t.isIdentifier(expr.object) && expr.object.name === 'styled') {
    return { matched: true, wrapsComponentTag: null };
  }
  if (
    t.isCallExpression(expr) &&
    t.isIdentifier(expr.callee) &&
    expr.callee.name === 'styled' &&
    expr.arguments.length === 1
  ) {
    const arg = expr.arguments[0];
    const wrapsComponent = t.isIdentifier(arg) && /^[A-Z]/.test(arg.name) ? arg.name : null;
    return { matched: true, wrapsComponentTag: wrapsComponent };
  }
  return { matched: false };
}
