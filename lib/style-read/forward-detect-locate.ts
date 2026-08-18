/**
 * @file A1 forward-detector — component declaration location (HYP-1229).
 *
 * Resolves a JSX tag name to its declaration (same-file or imported, via `resolveMasterComponent`
 * — the same import/alias/barrel resolution "Go to main component" HYP-563 uses) and classifies
 * what kind of declaration it is: a plain function component, a `memo`/`forwardRef`-wrapped one,
 * or a styled-components factory (`styled.tag(...)` / `styled(Component)(...)`, a known library
 * contract rather than user render code to trace).
 *
 * Ported from (and functionally a superset of) the HYP-901 `checkStyleForwarding`'s private
 * `locateComponentParams`/`findComponentParams` in
 * `vscode-extension/hypercanvas-preview/src/services/style-forwarding-check.ts` — that ext-only
 * file's write-path pre-check keeps its own copy rather than importing this one, deliberately, so
 * its existing HYP-901/HYP-987 regression tests (which assert the OLD, coarser `forwards` /
 * `unknown` / `not-forwarding` three-way verdict) are untouched by A1's richer per-channel
 * detection. Both copies resolve identically for every case those tests cover; if you fix a
 * resolution bug here, port the same fix there (and vice versa) — HYP-1235 tracks unifying them
 * once the ext's write-path check is itself rewired onto `ForwardDetectorResult`.
 */
import * as t from '@babel/types';
import type { FileIO } from '../ast/file-io';
import { resolveMasterComponent } from '../ast/master-component-resolver';
import { parseCode } from '../ast/parser';

export interface LocatedComponent {
  /** Null when the declaration is a styled-components factory, or an unresolvable shape. */
  fnNode: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | null;
  styledComponentsFactory: boolean;
  /** Set only when `styledComponentsFactory` and the wrap target is a custom (non-host) component. */
  styledWrapsComponentTag?: string;
  /** The AST of the file the declaration itself lives in. Currently unconsumed by
   *  `forward-detect.ts` (its Slot-import lookup was retired in favor of the general trace, see
   *  that file's header) — kept populated for the HYP-1235 recognizer unification. */
  fileAst: t.File;
  componentName: string;
  declarationFilePath: string;
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

  const resolution = await resolveMasterComponent({
    importerFilePath: input.filePath,
    importerSource,
    componentName: tagName,
    fileIO: input.fileIO,
    aliasMap: input.aliasMap,
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

/** Same disambiguation as HYP-987 P1 #7 — see style-forwarding-check.ts's `ComponentDeclMatch`. */
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
    return { fnNode: node, styledComponentsFactory: false, fileAst, componentName, declarationFilePath: filePath };
  }
  if (t.isVariableDeclaration(node)) {
    for (const d of node.declarations) {
      if (!t.isIdentifier(d.id) || !declMatches(d, d.id.name, match, fallbackLoc)) continue;
      return fromVariableInit(d.init, fileAst, filePath, componentName);
    }
  }
  return null;
}

function fromVariableInit(
  init: t.Expression | null | undefined,
  fileAst: t.File,
  filePath: string,
  componentName: string,
): LocatedComponent | null {
  const styled = classifyStyledComponentsExpression(init);
  if (styled.matched) {
    return {
      fnNode: null,
      styledComponentsFactory: true,
      styledWrapsComponentTag: styled.wrapsComponentTag ?? undefined,
      fileAst,
      componentName,
      declarationFilePath: filePath,
    };
  }
  const fn = unwrapToFunction(init);
  return fn
    ? { fnNode: fn, styledComponentsFactory: false, fileAst, componentName, declarationFilePath: filePath }
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

/** Only `memo`/`forwardRef` are transparent w.r.t. prop forwarding — see style-forwarding-check.ts. */
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
 * `wrapsComponentTag` — see forward-detect.ts's conservative (not recursive) handling of it.
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
