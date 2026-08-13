/**
 * @file Static (no-AI) scaffold generator for `.hyperide/preview.tsx` (HYP-880).
 *
 * Accessed via:
 *   - WrapperGenerator.ensureIsolationWrapper — when AI generation is
 *     unavailable (no key) or fails, the scaffold replaces the old bare
 *     pass-through fallback so the user gets the detected provider stack +
 *     TODO instructions instead of zero guidance (HYP-880).
 *   - `hypercanvas.generatePreviewWrapper` command — the "Generate preview
 *     wrapper" button on the provider-error card (ComponentErrorOverlay).
 *
 * What it does: parses the project's entry render tree (src/main.tsx →
 * `createRoot(...).render(...)`) plus the App component it mounts, collects
 * the `…Provider` JSX chain, and renders an HONEST wrapper template: the
 * provider stack and its imports are present but COMMENTED OUT with explicit
 * TODO stubs (HYP-880), and the active code is a pass-through `return children`.
 *
 * Why commented out, not live: providers almost always need stub data
 * (query clients, bootstrap envelopes, local consts from main.tsx) that a
 * static analyzer cannot invent. A live-but-crashing wrapper would break the
 * preview bundle (the e2e #11 blank-preview wedge); a pass-through with a
 * ready-to-fill skeleton keeps the invariant "the wrapper on disk is always
 * valid" while cutting the manual fix from archeology to uncomment-and-fill.
 * (Alex tg#5871: the fix must live in the product, not in the client repo.)
 *
 * Invariant: the generated content is DETERMINISTIC for unchanged project
 * files — WrapperGenerator relies on byte-equality to tell "our unedited
 * scaffold" (replaceable by a later AI upgrade) from a user-edited wrapper
 * (never clobbered).
 */

import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parse as babelParse } from '@babel/parser';
import type * as t from '@babel/types';
import { applyAlias } from '@lib/ast/master-component-resolver';
import { buildAliasMapFromTsconfig } from '@lib/ast/tsconfig-alias-map';
import {
  collectEntryStyleImports,
  collectRenderJSXArguments,
  jsxElementChildren,
  type ProviderContextFile,
  type RebaseContext,
  readProviderContextFiles,
  resolveImportLine,
  sliceOpeningTag,
  walkAst,
} from '../extension-provider-detection';

interface ScaffoldStubNote {
  /** What needs a stub — an identifier (`hostQueryClient`) or an attr snippet. */
  subject: string;
  /** Human note: where it lives / what to do. */
  note: string;
}

interface ScaffoldProvider {
  /** Tag name, incl. member tags — `QueryClientProvider`, `Theme.Provider`. */
  name: string;
  /** Verbatim opening tag (whitespace-collapsed to one line). */
  openTag: string;
  /** Import line for the provider itself (rebased to `.hyperide/`), or null when local. */
  importLine: string | null;
  /** Workspace-relative file the provider was found in. */
  sourceFile: string;
  /** Import lines for attribute identifiers that ARE importable. */
  attrImports: string[];
  /** Attribute values that need hand-written stubs. */
  stubs: ScaffoldStubNote[];
}

export interface PreviewWrapperScaffold {
  content: string;
  providerNames: string[];
  /** Workspace-relative files the providers were collected from (entry first). */
  sourceFiles: string[];
  /** Workspace-relative path of a detected test render helper, or null. */
  testRenderHelper: string | null;
}

/** How many component files to follow from the entry (main.tsx → App → …). */
const MAX_COMPONENT_DEPTH = 3;

/**
 * Build the scaffold for a workspace, or null when no provider chain can be
 * detected (callers then keep the plain pass-through fallback).
 */
export async function buildPreviewWrapperScaffold(root: string): Promise<PreviewWrapperScaffold | null> {
  const contextFiles = await readProviderContextFiles(root);
  const entry = findRenderEntry(contextFiles);
  if (!entry) return null;

  // tsconfig path-alias map (HYP-880 review finding): entry files commonly import
  // App via an alias (`import App from '@/App'`), not a relative path — the
  // cross-file walk below used to only follow relative imports, so an alias-based
  // project would stop at main.tsx and lose every provider living inside App.
  // Same resolution the "Go to main component" feature uses (AstService); best-
  // effort (missing/unparseable tsconfig.json → empty map → relative-only, as
  // before).
  const aliasMap = await loadAliasMap(root);

  const providers: ScaffoldProvider[] = [];
  const sourceFiles: string[] = [];
  let frontier: FileJsxFrontier | null = { file: entry.file, ast: entry.ast, jsx: entry.renderArg };
  for (let depth = 0; frontier && depth < MAX_COMPONENT_DEPTH; depth++) {
    const walked = collectProviderPath(frontier.jsx);
    if (walked.providers.length > 0) sourceFiles.push(frontier.file.relativePath);
    const ctx = rebaseContextFor(root, frontier.file, frontier.ast);
    for (const element of walked.providers) {
      providers.push(buildScaffoldProvider(element, frontier.file, ctx));
    }
    frontier = await followInnermostComponent(walked.pathElements, frontier, root, aliasMap);
  }
  if (providers.length === 0) return null;

  const testRenderHelper = await findTestRenderHelper(root);
  // Entry global stylesheets (HYP-880 review finding): a Mantine/Tamagui/etc. app
  // depends on its entry's global CSS to look right — the AI-generation prompt
  // already asks for it, so the static scaffold needs the same source of truth or
  // a correctly-filled-in provider stack can still render unstyled.
  const styleImports = collectEntryStyleImports(root, path.join(root, '.hyperide'), contextFiles);
  const content = renderScaffoldTemplate({ providers, sourceFiles, testRenderHelper, styleImports });
  return { content, providerNames: providers.map((p) => p.name), sourceFiles, testRenderHelper };
}

// ============================================================================
// Entry discovery + provider-path walk
// ============================================================================

interface FileJsxFrontier {
  file: ProviderContextFile;
  ast: t.File;
  jsx: t.JSXElement | t.JSXFragment;
}

interface RenderEntry extends FileJsxFrontier {
  renderArg: t.JSXElement | t.JSXFragment;
}

/**
 * Find the entry file and the ReactDOM render argument to analyze. When a file
 * has several mounts (e.g. HyperIDE's own injected preview mount), the one
 * whose subtree carries the most `…Provider` elements wins — the real app tree.
 */
function findRenderEntry(contextFiles: ProviderContextFile[]): RenderEntry | null {
  for (const file of contextFiles) {
    const ast = parseTsx(file.content);
    if (!ast) continue;
    const args = collectRenderJSXArguments(ast);
    if (args.length === 0) continue;
    const best = args.reduce((a, b) => (providerCount(b) > providerCount(a) ? b : a));
    return { file, ast, jsx: best, renderArg: best };
  }
  return null;
}

function parseTsx(content: string): t.File | null {
  try {
    return babelParse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true });
  } catch {
    return null;
  }
}

/**
 * Number of `…Provider` elements in a JSX subtree — the walk's branch-picking metric.
 * Self-closing providers are excluded, matching {@link collectProviderPath}'s own
 * eligibility check — otherwise this metric could steer a fork toward a branch for a
 * self-closing `<XProvider/>` that collectProviderPath then declines to collect
 * (a provider with no children can't wrap anything), silently dropping a sibling
 * branch that had real usable providers (HYP-880 review finding).
 *
 * Also skips nested function scopes (same `isNestedScopeBoundary` rule
 * {@link firstReturnedJsx} uses) — `<div>{items.map(i => <XProvider key={i}>…)}</div>`
 * would otherwise inflate the count with providers rendered per-list-item inside a
 * closure, which are dynamic/repeated content, not part of the single static provider
 * chain this metric is meant to compare (HYP-880 review finding).
 */
function providerCount(node: t.Node): number {
  let count = 0;
  walkAst(node, (n) => {
    if (isNestedScopeBoundary(n)) return false;
    if (n.type !== 'JSXElement' || n.openingElement.selfClosing) return;
    const name = fullTagName(n.openingElement.name);
    if (name && isProviderTagName(name)) count++;
  });
  return count;
}

/** `QueryClientProvider`, `Theme.Provider`, bare react-redux `Provider` — all count. */
function isProviderTagName(name: string): boolean {
  return name.endsWith('Provider');
}

/** Dotted tag name (`Theme.Provider`) for identifier/member tags; null for namespaced tags. */
function fullTagName(name: t.JSXOpeningElement['name']): string | null {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') {
    const object = fullTagName(name.object);
    return object ? `${object}.${name.property.name}` : null;
  }
  return null;
}

interface ProviderPathWalk {
  /** `…Provider` elements on the walked path, outer → inner. */
  providers: t.JSXElement[];
  /** EVERY element on the walked path (providers and non-providers), outer → inner. */
  pathElements: t.JSXElement[];
}

/**
 * Walk DOWN the JSX tree from a root, following the child branch with the most
 * providers at every fork (a fragment sibling like `<Toaster/>` never carries
 * the app), collecting `…Provider` elements along the way. Unlike the strict
 * single-child chain in extension-provider-detection (which must bail on
 * ambiguity because it REPLICATES live code), the scaffold only produces a
 * commented template — a best-effort path through forks is safe and useful.
 */
function collectProviderPath(root: t.JSXElement | t.JSXFragment): ProviderPathWalk {
  const providers: t.JSXElement[] = [];
  const pathElements: t.JSXElement[] = [];
  let current: t.JSXElement | t.JSXFragment | undefined = root;
  while (current) {
    if (current.type === 'JSXElement') {
      pathElements.push(current);
      const name = fullTagName(current.openingElement.name);
      if (name && isProviderTagName(name) && !current.openingElement.selfClosing) providers.push(current);
    }
    current = pickDescendChild(jsxElementChildren(current));
  }
  return { providers, pathElements };
}

/** The child subtree richest in providers; ties go to the first child (document order). */
function pickDescendChild(children: Array<t.JSXElement | t.JSXFragment>): t.JSXElement | t.JSXFragment | undefined {
  if (children.length <= 1) return children[0];
  let best = children[0];
  let bestCount = providerCount(best);
  for (const child of children.slice(1)) {
    const count = providerCount(child);
    if (count > bestCount) {
      best = child;
      bestCount = count;
    }
  }
  return best;
}

// ============================================================================
// Following the mounted component (main.tsx → App.tsx)
// ============================================================================

/** Best-effort tsconfig.json path-alias map at the workspace root; `{}` when missing/unparseable. */
async function loadAliasMap(root: string): Promise<Record<string, string>> {
  try {
    const source = await readFile(path.join(root, 'tsconfig.json'), 'utf-8'); // nosemgrep: path-join-resolve-traversal -- fixed filename under the user's own workspace
    return buildAliasMapFromTsconfig(source, root);
  } catch {
    return {};
  }
}

/**
 * Resolve the innermost walked element that is a RELATIVE or tsconfig-ALIAS
 * import (the `<App/>` the entry mounts), read its file, and return the
 * component's root JSX as the next frontier — providers often live inside App,
 * not the entry (conloca-app). Returns null when nothing on the path resolves
 * (leaf is local / a bare package with no matching alias).
 *
 * Elements that are themselves `…Provider`s are never followed: they are
 * already IN the scaffold, and their implementation's internal
 * `<XContext.Provider value={…}>` is what they provide — descending into one
 * would double-scaffold it as noise (seen on conloca-app's AuthProvider).
 */
async function followInnermostComponent(
  pathElements: t.JSXElement[],
  frontier: FileJsxFrontier,
  root: string,
  aliasMap: Record<string, string>,
): Promise<FileJsxFrontier | null> {
  for (let i = pathElements.length - 1; i >= 0; i--) {
    const name = fullTagName(pathElements[i].openingElement.name);
    if (!name || name.includes('.') || !/^[A-Z]/.test(name)) continue;
    if (isProviderTagName(name)) continue;
    const next = await resolveComponentSource(name, frontier, root, aliasMap);
    if (next) return next;
  }
  return null;
}

/** File-extension candidates tried when resolving a relative component import. */
const COMPONENT_FILE_SUFFIXES = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

/** Find `name`'s relative or alias import in the frontier file, load + parse the target, locate its root JSX. */
async function resolveComponentSource(
  name: string,
  frontier: FileJsxFrontier,
  root: string,
  aliasMap: Record<string, string>,
): Promise<FileJsxFrontier | null> {
  const binding = findImportBinding(frontier.ast, name);
  if (!binding) return null;
  const baseAbs = binding.source.startsWith('.')
    ? path.resolve(path.dirname(path.join(root, frontier.file.relativePath)), binding.source)
    : applyAlias(binding.source, aliasMap);
  if (!baseAbs) return null;
  for (const suffix of ['', ...COMPONENT_FILE_SUFFIXES]) {
    const abs = baseAbs + suffix;
    let content: string;
    try {
      content = await readFile(abs, 'utf-8'); // nosemgrep: path-join-resolve-traversal -- entry-file import specifier inside the user's own workspace
    } catch {
      continue;
    }
    // A readable file at this suffix that doesn't parse or has no discoverable component JSX
    // is not necessarily the RIGHT candidate — try the next suffix rather than giving up
    // (e.g. `./Foo.ts` reads but is a type-only re-export; `./Foo/index.tsx` is the real
    // component; HYP-880 review finding).
    const ast = parseTsx(content);
    if (!ast) continue;
    const jsx = findComponentRootJsx(ast, binding.importedName);
    if (!jsx) continue;
    const relativePath = path.relative(root, abs).replace(/\\/g, '/');
    return { file: { relativePath, content }, ast, jsx };
  }
  return null;
}

interface ImportBinding {
  source: string;
  /** The exported name in the target module; 'default' for default imports. */
  importedName: string;
}

function findImportBinding(ast: t.File, localName: string): ImportBinding | null {
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    for (const spec of stmt.specifiers) {
      if (spec.local.name !== localName) continue;
      if (spec.type === 'ImportDefaultSpecifier') return { source: stmt.source.value, importedName: 'default' };
      if (spec.type === 'ImportSpecifier') {
        const imported = spec.imported.type === 'Identifier' ? spec.imported.name : localName;
        return { source: stmt.source.value, importedName: imported };
      }
    }
  }
  return null;
}

/**
 * Root JSX returned by the module's component: the default export for
 * `importedName === 'default'`, otherwise the named export. Handles function
 * declarations, arrow/function expressions, and `export default Identifier`
 * pointing at a local declaration.
 */
function findComponentRootJsx(ast: t.File, importedName: string): t.JSXElement | t.JSXFragment | null {
  const fn = importedName === 'default' ? findDefaultExportFunction(ast) : findNamedExportFunction(ast, importedName);
  return fn ? firstReturnedJsx(fn) : null;
}

type ComponentFn = t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;

/** HOC names whose call passes the rendered JSX through unchanged. */
const TRANSPARENT_HOC_NAMES = new Set(['memo', 'forwardRef']);

/**
 * Unwrap `memo(fn)` / `forwardRef(fn)` / `React.memo(fn)` — and nested combinations like
 * `memo(forwardRef(fn))` — down to the inner component function. Both HOCs pass their JSX
 * through unchanged, so the provider stack a static scan needs is still reachable inside.
 * Without this, `const App = memo(() => <AuthProvider>...)` (or a `forwardRef`-wrapped root,
 * a common router/layout pattern) made the call-expression initializer fall through every
 * check below, `findComponentRootJsx` returned null, and the no-AI scaffold silently fell
 * back to the bare wrapper even though providers were statically present (HYP-880 review
 * finding, PR #618 codex).
 */
function unwrapKnownHOC(node: t.Node): ComponentFn | null {
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return node;
  if (node.type !== 'CallExpression' || node.arguments.length === 0) return null;
  const { callee } = node;
  const hocName =
    callee.type === 'Identifier'
      ? callee.name
      : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
        ? callee.property.name
        : null;
  if (!hocName || !TRANSPARENT_HOC_NAMES.has(hocName)) return null;
  return unwrapKnownHOC(node.arguments[0]);
}

function findDefaultExportFunction(ast: t.File): ComponentFn | null {
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ExportDefaultDeclaration') continue;
    const decl = stmt.declaration;
    if (
      decl.type === 'FunctionDeclaration' ||
      decl.type === 'ArrowFunctionExpression' ||
      decl.type === 'FunctionExpression'
    ) {
      return decl;
    }
    if (decl.type === 'Identifier') return findLocalFunction(ast, decl.name);
    if (decl.type === 'CallExpression') {
      const fn = unwrapKnownHOC(decl);
      if (fn) return fn;
    }
  }
  return null;
}

function findNamedExportFunction(ast: t.File, name: string): ComponentFn | null {
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ExportNamedDeclaration' || !stmt.declaration) continue;
    const fn = functionFromDeclaration(stmt.declaration, name);
    if (fn) return fn;
  }
  // `export { App }` re-exporting a local declaration
  return findLocalFunction(ast, name);
}

function findLocalFunction(ast: t.File, name: string): ComponentFn | null {
  for (const stmt of ast.program.body) {
    const fn = functionFromDeclaration(stmt, name);
    if (fn) return fn;
  }
  return null;
}

function functionFromDeclaration(node: t.Node, name: string): ComponentFn | null {
  if (node.type === 'FunctionDeclaration' && node.id?.name === name) return node;
  if (node.type === 'VariableDeclaration') {
    for (const d of node.declarations) {
      if (d.id.type !== 'Identifier' || d.id.name !== name || !d.init) continue;
      const fn = unwrapKnownHOC(d.init);
      if (fn) return fn;
    }
  }
  return null;
}

/**
 * Unwrap JSX reachable through `?:`/`&&`/`||` — `return cond ? <A/> : <B/>` and
 * `return cond && <A/>` are common conditional-render idioms (a ternary is the most
 * frequent alternative to `if (!ready) return <Spinner/>;`) and would otherwise be
 * invisible to firstReturnedJsx (HYP-880 review finding). Each JSX arm becomes its
 * own candidate for the provider-count comparison below — a ternary's provider-rich
 * branch is picked the same way a guard-vs-main `if`/`return` pair is.
 */
function collectJsxFromExpression(expr: t.Node, out: (t.JSXElement | t.JSXFragment)[]): void {
  if (expr.type === 'JSXElement' || expr.type === 'JSXFragment') {
    out.push(expr);
  } else if (expr.type === 'ConditionalExpression') {
    collectJsxFromExpression(expr.consequent, out);
    collectJsxFromExpression(expr.alternate, out);
  } else if (expr.type === 'LogicalExpression') {
    collectJsxFromExpression(expr.left, out);
    collectJsxFromExpression(expr.right, out);
  }
}

/**
 * The JSX a component function returns (arrow expression body, or a `return` statement in its
 * OWN scope — walkAst is told to skip descending into nested function/class bodies so a
 * closure's `return` (a `.map` callback, a helper defined inside the component) can never be
 * mistaken for the component's own return; HYP-880 review finding). When the component has
 * multiple own-scope returns (a loading/error guard before the main render is common — e.g.
 * `if (!ready) return <Spinner/>;`, or the ternary/`&&` equivalent — see
 * {@link collectJsxFromExpression}), prefers whichever candidate has the MOST providers
 * (matching the fork-picking metric used elsewhere in this file — {@link pickDescendChild});
 * ties (including the common "no providers anywhere" 0-vs-0 case) go to the LAST candidate,
 * since idiomatic guards precede the main render. Picking by count rather than "first
 * non-zero" also covers the rarer case where the guard branch itself happens to contain a
 * provider (HYP-880 review finding) — the main render, if richer, still wins.
 */
function firstReturnedJsx(fn: ComponentFn): t.JSXElement | t.JSXFragment | null {
  const candidates: (t.JSXElement | t.JSXFragment)[] = [];
  if (fn.body.type === 'JSXElement' || fn.body.type === 'JSXFragment') {
    candidates.push(fn.body);
  } else if (fn.body.type === 'BlockStatement') {
    walkAst(fn.body, (n) => {
      if (isNestedScopeBoundary(n)) return false;
      if (n.type === 'ReturnStatement' && n.argument) collectJsxFromExpression(n.argument, candidates);
    });
  } else {
    // Arrow function with a non-JSX, non-block expression body — e.g. `() => (cond ? <A/> : <B/>)`.
    collectJsxFromExpression(fn.body, candidates);
  }
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestCount = providerCount(best);
  for (const candidate of candidates.slice(1)) {
    const count = providerCount(candidate);
    if (count >= bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Function/class boundaries — a `return` inside one of these belongs to ITS scope, not the enclosing component's. */
function isNestedScopeBoundary(n: t.Node): boolean {
  return (
    n.type === 'FunctionDeclaration' ||
    n.type === 'FunctionExpression' ||
    n.type === 'ArrowFunctionExpression' ||
    n.type === 'ClassDeclaration' ||
    n.type === 'ClassExpression'
  );
}

// ============================================================================
// Per-provider scaffold data (imports + stub notes)
// ============================================================================

function rebaseContextFor(root: string, file: ProviderContextFile, ast: t.File): RebaseContext {
  return { ast, root, previewDir: path.join(root, '.hyperide'), sourceRelativePath: file.relativePath };
}

function buildScaffoldProvider(element: t.JSXElement, file: ProviderContextFile, ctx: RebaseContext): ScaffoldProvider {
  const name = fullTagName(element.openingElement.name) ?? 'UnknownProvider';
  const importName = name.split('.')[0]; // member tag `Theme.Provider` imports `Theme`
  const rawTag = sliceOpeningTag(element.openingElement, file.content) ?? `<${name}>`;
  const { attrImports, stubs } = analyzeProviderAttributes(element.openingElement, file, ctx);
  return {
    name,
    openTag: rawTag.replace(/\s+/g, ' '),
    importLine: resolveImportLine(importName, ctx),
    sourceFile: file.relativePath,
    attrImports,
    stubs,
  };
}

/**
 * Split a provider's attributes into importable identifier values (the import
 * line is carried into the scaffold) and everything else (a TODO stub note, HYP-880).
 * Literal attrs (`defaultTheme="dark"`) need nothing and produce neither.
 */
function analyzeProviderAttributes(
  opening: t.JSXOpeningElement,
  file: ProviderContextFile,
  ctx: RebaseContext,
): { attrImports: string[]; stubs: ScaffoldStubNote[] } {
  const attrImports: string[] = [];
  const stubs: ScaffoldStubNote[] = [];
  for (const attr of opening.attributes) {
    if (attr.type === 'JSXSpreadAttribute') {
      stubs.push({
        subject: spliceSource(attr, file.content, '{...props}'),
        note: `spread props in ${file.relativePath} — provide preview values`,
      });
      continue;
    }
    const value = attr.value;
    if (!value || value.type === 'StringLiteral') continue;
    if (value.type !== 'JSXExpressionContainer') continue;
    const expr = value.expression;
    if (expr.type === 'StringLiteral' || expr.type === 'NumericLiteral' || expr.type === 'BooleanLiteral') continue;
    if (expr.type === 'Identifier') {
      const importLine = resolveImportLine(expr.name, ctx);
      if (importLine) attrImports.push(importLine);
      else
        stubs.push({
          subject: `\`${expr.name}\``,
          note: `defined locally in ${file.relativePath} — re-create a preview-safe value here`,
        });
      continue;
    }
    stubs.push({
      subject: `\`${attr.name.type === 'JSXIdentifier' ? attr.name.name : 'attr'}={${spliceSource(expr, file.content, '…')}}\``,
      note: `from ${file.relativePath} — fill with a preview-safe value`,
    });
  }
  return { attrImports, stubs };
}

/** Verbatim (whitespace-collapsed, length-capped) source of a node, or a fallback. */
function spliceSource(node: t.Node, content: string, fallback: string): string {
  if (typeof node.start !== 'number' || typeof node.end !== 'number') return fallback;
  const raw = content.slice(node.start, node.end).replace(/\s+/g, ' ');
  return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
}

// ============================================================================
// Test render-helper detection
// ============================================================================

/** Dirs never worth descending into while looking for a test render helper. */
const HELPER_SCAN_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.hyperide',
  '.next',
]);
const HELPER_FILE_PATTERN = /(test-utils|test-helpers|render-with|renderwith|test\/utils)/i;
const HELPER_SCAN_MAX_DIRS = 200;

/**
 * Find a "render with providers" test helper (e.g. conloca-app's
 * `src/app/test-utils/render-with-host-providers.tsx`) so the scaffold can
 * point at it — its provider setup is usually 90% of the wrapper. Bounded
 * breadth-first filename scan; first match in BFS order wins (determinism).
 */
export async function findTestRenderHelper(root: string): Promise<string | null> {
  const queue: string[] = ['src', 'app', 'test', 'tests'];
  let scanned = 0;
  while (queue.length > 0 && scanned < HELPER_SCAN_MAX_DIRS) {
    const rel = queue.shift() as string;
    scanned++;
    let entries;
    try {
      entries = await readdir(path.join(root, rel), { withFileTypes: true }); // nosemgrep: path-join-resolve-traversal -- fixed dir names under the user's own workspace
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!HELPER_SCAN_SKIP_DIRS.has(entry.name)) queue.push(entryRel);
        continue;
      }
      if (
        /\.(tsx|ts|jsx|js)$/.test(entry.name) &&
        HELPER_FILE_PATTERN.test(entryRel) &&
        !/\.(test|spec)\./.test(entry.name)
      ) {
        return entryRel;
      }
    }
  }
  return null;
}

// ============================================================================
// Template rendering
// ============================================================================

interface TemplateInput {
  providers: ScaffoldProvider[];
  sourceFiles: string[];
  testRenderHelper: string | null;
  /** Entry global stylesheet import lines (side-effect only) — emitted LIVE, never
   * commented out: a bare `import './x.css'` has no stub-data dependency and can't
   * crash, unlike a provider import that may need runtime values. */
  styleImports: string[];
}

/** Marker distinguishing a generated scaffold from the AI wrapper and the bare fallback. */
export const SCAFFOLD_MARKER = '@hyperide-scaffold';

function renderScaffoldTemplate(input: TemplateInput): string {
  const header = renderHeaderComment(input);
  const styles = input.styleImports.length > 0 ? `${input.styleImports.join('\n')}\n` : '';
  const imports = renderCommentedImports(input.providers);
  const body = renderWrapperFunction(input.providers);
  return `// @hyperide-managed ${SCAFFOLD_MARKER}\n${header}\nimport type { ReactNode } from 'react';\n${styles}\n${imports}\n${body}`;
}

/** Escape the comment terminator so verbatim attr sources can never close the generated doc comment early. */
function blockCommentSafe(text: string): string {
  return text.replace(/\*\//g, '*\\/');
}

function renderHeaderComment({ providers, sourceFiles, testRenderHelper }: TemplateInput): string {
  const stubs = providers.flatMap((p) => p.stubs);
  const lines = [
    '/**',
    ' * PreviewWrapper — provider shell for HyperIDE isolated previews.',
    ' *',
    ' * HyperIDE generated this file because a previewed component crashed with a',
    ' * provider-context error ("useX must be used inside <XProvider>" kind).',
    ' * Provider stack detected in:',
    ...sourceFiles.map((f) => ` *   - ${f}`),
    ' *',
    ' * Previews currently render WITHOUT providers (pass-through). To mount them:',
    ' *   1. Uncomment the provider imports and the provider stack below.',
    ' *   2. Fill every TODO stub with preview-safe values (no network, no real backend).', // HYP-880: literal generated-file text, not a dev leftover
    ' *   3. Save — the preview reloads automatically.',
    ' *',
    ' * If the provider named in the crash is NOT in the stack below, it is mounted',
    ' * deeper in your app (behind routing/auth) — import it and add it around',
    ' * {children} here manually.',
  ];
  if (stubs.length > 0) {
    lines.push(' *', ' * Stub data you need to provide:');
    for (const stub of stubs) lines.push(blockCommentSafe(` *   - ${stub.subject} — ${stub.note}`));
  }
  if (testRenderHelper) {
    lines.push(
      ' *',
      ` * TIP: ${testRenderHelper} already wires providers for tests —`,
      ' * reuse its setup (stub clients, fixture data) as the base for this wrapper.',
    );
  }
  lines.push(' */');
  return `${lines.join('\n')}\n`;
}

function renderCommentedImports(providers: ScaffoldProvider[]): string {
  const lines: string[] = ['// Provider imports — uncomment as you enable the stack below.'];
  const seen = new Set<string>();
  for (const provider of providers) {
    const importLines = provider.importLine
      ? [provider.importLine, ...provider.attrImports]
      : [
          `// TODO: \`${provider.name}\` is not importable — it is local to ${provider.sourceFile}; export it there or re-create it here.`, // HYP-880: literal generated-file text, not a dev leftover
          ...provider.attrImports,
        ];
    for (const line of importLines) {
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line.startsWith('//') ? line : `// ${line}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderWrapperFunction(providers: ScaffoldProvider[]): string {
  const stack = renderCommentedStack(providers);
  return [
    'export function PreviewWrapper({ children }: { children: ReactNode }) {',
    '  // TODO(HyperIDE): uncomment this provider stack (copied from your app,', // HYP-880: literal generated-file text, not a dev leftover
    '  // outer → inner), fill the stubs, then delete the pass-through return below.',
    '  //',
    ...stack,
    '  return children;',
    '}',
    '',
  ].join('\n');
}

/** The detected provider stack as commented-out JSX, `{children}` innermost. */
function renderCommentedStack(providers: ScaffoldProvider[]): string[] {
  const lines: string[] = ['  // return ('];
  providers.forEach((provider, i) => {
    lines.push(`  //   ${'  '.repeat(i)}${provider.openTag}`);
  });
  lines.push(`  //   ${'  '.repeat(providers.length)}{children}`);
  for (let i = providers.length - 1; i >= 0; i--) {
    lines.push(`  //   ${'  '.repeat(i)}</${providers[i].name}>`);
  }
  lines.push('  // );');
  return lines;
}
