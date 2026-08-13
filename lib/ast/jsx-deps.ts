/**
 * JSX subtree dependency analysis + cross-file import bookkeeping.
 *
 * Used by AstService.moveElement (Task 3 of the move-any-to-any plan) to:
 *   1. Walk a moved JSX subtree and collect every external identifier name
 *      it references (component tags, member roots, expression identifiers).
 *   2. Intersect those names with the SOURCE file's import declarations to
 *      decide which imports must be replicated in the TARGET file.
 *   3. Replicate (merging into an existing same-source import where possible),
 *      rewriting relative paths so they resolve against the target file's
 *      directory.
 *   4. After the cut, prune SOURCE imports whose local names are no longer
 *      referenced anywhere in the source AST.
 *
 * The "external" filter is deliberately just "is this name in source file's
 * import declarations?". We don't try to do scope analysis to spot identifiers
 * bound to parameters / hooks / locals — those belong to Task 4/5 (props
 * lifting / value inlining). Over-collection is harmless because the import
 * intersection discards anything we can't actually replicate.
 */

import * as nodePath from 'node:path';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';

// @ts-expect-error - babel/traverse has ESM/CJS interop quirks; this matches
// the same shim used in lib/ast/operations.ts.
const traverse = _traverse.default || _traverse;

/**
 * Walk a JSX subtree and collect every identifier name it references from the
 * surrounding scope. Returns the raw set — caller intersects with imports.
 *
 * Includes:
 *   - JSXElement opening name root (PascalCase components AND lower-case
 *     member roots like `motion.div` → "motion").
 *   - Every Identifier inside JSXExpressionContainer / JSXSpreadAttribute /
 *     JSXSpreadChild expression slots.
 *   - Recurses through nested JSXElement / JSXFragment children.
 *
 * Excludes:
 *   - Lower-case JSXIdentifier element names (`<div>`, `<span>` — host tags,
 *     never imported).
 *   - JSX attribute names (`className`, `onClick` — keys, not references).
 */
export function collectJsxExternalRefs(root: t.JSXElement): Set<string> {
  const names = new Set<string>();

  function visit(node: t.Node | null | undefined): void {
    if (!node) return;

    if (t.isJSXElement(node)) {
      // Collect the root identifier of the opening element name.
      const opening = node.openingElement.name;
      const rootName = jsxNameRoot(opening);
      if (rootName) {
        // `<Foo />` (PascalCase), `<Foo.Bar />` (member: collect "Foo"), and
        // lower-case member roots like `<motion.div />` (collect "motion") are
        // all external references. Plain `<div>` (JSXIdentifier with
        // lower-case name) is NOT — host tags are never imported.
        const isMember = t.isJSXMemberExpression(opening);
        const isPlainLower = t.isJSXIdentifier(opening) && /^[a-z]/.test(rootName);
        if (!isPlainLower || isMember) {
          names.add(rootName);
        }
      }

      // Walk attribute expression slots.
      for (const attr of node.openingElement.attributes) {
        if (t.isJSXAttribute(attr)) {
          if (attr.value && t.isJSXExpressionContainer(attr.value)) {
            collectExprIdentifiers(attr.value.expression, names);
          }
        } else if (t.isJSXSpreadAttribute(attr)) {
          collectExprIdentifiers(attr.argument, names);
        }
      }

      for (const child of node.children) visit(child);
      return;
    }

    if (t.isJSXFragment(node)) {
      for (const child of node.children) visit(child);
      return;
    }

    if (t.isJSXExpressionContainer(node)) {
      collectExprIdentifiers(node.expression, names);
      return;
    }

    if (t.isJSXSpreadChild(node)) {
      collectExprIdentifiers(node.expression, names);
      return;
    }
  }

  visit(root);
  return names;
}

/**
 * Walk a JSX subtree and collect every identifier name BOUND inside it
 * (arrow / function params, var/let/const declarations, destructuring
 * patterns). Caller subtracts these from `collectJsxExternalRefs` before
 * surfacing unresolved-ref adjustments — the over-collection in the refs
 * walker picks up arrow params (`(item) => <li>{item}</li>`) and inline
 * destructures (`const { x } = ctx`), but those bindings live INSIDE the
 * moved subtree and travel with it, so they don't need replication.
 */
export function collectJsxLocalBindings(root: t.JSXElement): Set<string> {
  const bound = new Set<string>();

  // Wrap in a synthetic file program so `@babel/traverse` accepts it.
  // JSXElement isn't a valid Program-level statement, so we wrap it in an
  // ExpressionStatement (matching `collectExprIdentifiers`).
  const file = t.file(t.program([t.expressionStatement(root as unknown as t.Expression)]));
  traverse(file, {
    Function(path: NodePath<t.Function>) {
      for (const param of path.node.params) {
        collectPatternBindings(param, bound);
      }
    },
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      collectPatternBindings(path.node.id, bound);
    },
    CatchClause(path: NodePath<t.CatchClause>) {
      if (path.node.param) collectPatternBindings(path.node.param, bound);
    },
  });

  return bound;
}

function collectPatternBindings(pattern: t.Node, out: Set<string>): void {
  if (t.isIdentifier(pattern)) {
    out.add(pattern.name);
    return;
  }
  if (t.isObjectPattern(pattern)) {
    for (const prop of pattern.properties) {
      if (t.isObjectProperty(prop)) {
        collectPatternBindings(prop.value as t.Node, out);
      } else if (t.isRestElement(prop)) {
        collectPatternBindings(prop.argument, out);
      }
    }
    return;
  }
  if (t.isArrayPattern(pattern)) {
    for (const elt of pattern.elements) {
      if (elt) collectPatternBindings(elt, out);
    }
    return;
  }
  if (t.isAssignmentPattern(pattern)) {
    collectPatternBindings(pattern.left, out);
    return;
  }
  if (t.isRestElement(pattern)) {
    collectPatternBindings(pattern.argument, out);
  }
}

/**
 * Leftmost binding identifier of a JSX tag name. For `<Foo.Bar>` returns `Foo`
 * (the imported binding), for `<Foo>` returns `Foo`, for `<ns:tag>` returns `ns`.
 * This is the name to look up against the file's imports.
 */
export function jsxNameRoot(name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string | null {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) {
    const obj = name.object as t.JSXMemberExpression | t.JSXIdentifier;
    return jsxNameRoot(obj);
  }
  if (t.isJSXNamespacedName(name)) return name.namespace.name;
  return null;
}

/**
 * Walk an expression and collect every Identifier reference. Wraps the
 * expression in a synthetic File so `@babel/traverse` can do its bookkeeping.
 *
 * Caveat: this over-collects (it adds arrow-function param names, destructure
 * keys, etc.) but that's fine — the caller intersects against the source
 * file's imports, so non-imported names are discarded for free.
 */
function collectExprIdentifiers(expr: t.Node | null | undefined, out: Set<string>): void {
  if (!expr) return;
  if (t.isJSXEmptyExpression(expr)) return;

  // Nested JSX inside an expression slot: recurse via the JSX collector so we
  // pick up its element-name roots and attributes uniformly.
  if (t.isJSXElement(expr)) {
    const inner = collectJsxExternalRefs(expr);
    for (const n of inner) out.add(n);
    return;
  }
  if (t.isJSXFragment(expr)) {
    for (const child of expr.children) {
      if (t.isJSXElement(child)) {
        const inner = collectJsxExternalRefs(child);
        for (const n of inner) out.add(n);
      } else {
        // Fragment children that aren't JSX (text, expressions) — recurse.
        if (t.isJSXExpressionContainer(child)) collectExprIdentifiers(child.expression, out);
      }
    }
    return;
  }

  // Wrap arbitrary expression in a synthetic file and traverse for identifiers.
  const file = t.file(t.program([t.expressionStatement(expr as t.Expression)]));
  traverse(file, {
    Identifier(path: NodePath<t.Identifier>) {
      // Skip non-references (object keys, member properties without computed,
      // import specifiers — the latter doesn't appear inside an expression
      // slot but the guard is cheap).
      const parent = path.parent;
      if (t.isMemberExpression(parent) && parent.property === path.node && !parent.computed) {
        return;
      }
      if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) {
        return;
      }
      out.add(path.node.name);
    },
    JSXIdentifier(path: NodePath<t.JSXIdentifier>) {
      // Inside JSX nested in expressions (handled above already), but harmless
      // double-coverage — set semantics dedupe.
      const parent = path.parent;
      if (t.isJSXOpeningElement(parent) && parent.name === path.node) {
        if (/^[A-Z]/.test(path.node.name)) out.add(path.node.name);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Import discovery + replication
// ---------------------------------------------------------------------------

export interface ImportSpecifierInfo {
  /** The ImportDeclaration node containing the specifier. */
  declaration: t.ImportDeclaration;
  /** The specific specifier (named, default, or namespace). */
  specifier: t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier;
}

/**
 * Find the import declaration + specifier that brings in `localName` in `ast`.
 * Matches the LOCAL binding name (what the file uses), not the imported name —
 * so `import { foo as bar } from 'x'` matches when `localName === 'bar'`.
 */
export function findImportForName(ast: t.File, localName: string): ImportSpecifierInfo | null {
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue;
    for (const spec of node.specifiers) {
      if (spec.local.name === localName) {
        return { declaration: node, specifier: spec };
      }
    }
  }
  return null;
}

/** Outcome of replicateImport. The string variants surface in `adjustments`. */
export type ReplicateImportResult =
  | { kind: 'added'; sourceValue: string }
  | { kind: 'already-present' }
  | { kind: 'collision'; existingSourceValue: string; expectedSourceValue: string };

/**
 * Replicate an import in `targetAst` so `localName` resolves to the same
 * module as in the source. Merges into an existing same-source declaration
 * when possible (avoids `import { A } with from './x'; import { B } from './x'`).
 *
 * `sourceFilePath` is the source file's absolute path (where the import
 * originated). `targetFilePath` is the destination file's absolute path —
 * relative import sources are recomputed against its directory; bare and
 * alias specifiers (`react`, `@/lib/x`) pass through unchanged.
 *
 * Preserves `importKind` (`'type'` / `'value'`) on both the declaration
 * (so `verbatimModuleSyntax` projects survive a cross-file move) and the
 * individual specifier (so `import { type Foo, Bar }` shapes round-trip).
 *
 * Returns:
 *   - `{ kind: 'added' }` if a fresh declaration / merged specifier was emitted.
 *   - `{ kind: 'already-present' }` if target already imports `localName` from
 *     the same module — nothing to do.
 *   - `{ kind: 'collision' }` if target already imports `localName` from a
 *     DIFFERENT module. Caller surfaces this as an `adjustments` warning;
 *     the moved subtree will reference the existing (wrong) binding at
 *     runtime, which is incorrect, but we don't silently rewrite the user's
 *     existing import for them.
 */
export function replicateImport(
  targetAst: t.File,
  info: ImportSpecifierInfo,
  sourceFilePath: string,
  targetFilePath: string,
): ReplicateImportResult {
  const localName = info.specifier.local.name;
  const newSourceValue = rewriteImportSource(info.declaration.source.value, sourceFilePath, targetFilePath);

  // Already imported under the same local name?
  const preexisting = findImportForName(targetAst, localName);
  if (preexisting) {
    if (preexisting.declaration.source.value === newSourceValue) {
      return { kind: 'already-present' };
    }
    // Same local name imported from a different module — name collision.
    // We don't auto-rename: surface to caller for `adjustments`.
    return {
      kind: 'collision',
      existingSourceValue: preexisting.declaration.source.value,
      expectedSourceValue: newSourceValue,
    };
  }

  const declImportKind = info.declaration.importKind ?? 'value';

  // Try to merge into an existing import from the same source AND with
  // the same importKind. Mixing `import type {}` and `import {}` from the
  // same module on one declaration is illegal, so we keep them separate.
  const existing = targetAst.program.body.find(
    (n): n is t.ImportDeclaration =>
      t.isImportDeclaration(n) && n.source.value === newSourceValue && (n.importKind ?? 'value') === declImportKind,
  );

  // Build a fresh specifier of the same kind so we don't carry babel
  // location metadata from the source AST into the target.
  const fresh = cloneSpecifier(info.specifier);

  if (existing && canMergeIntoDeclaration(existing, fresh)) {
    // Spec order on a single ImportDeclaration:
    //   ImportedDefaultBinding [, NameSpaceImport | NamedImports]
    // i.e. default specifier (if any) MUST come first, then namespace OR named
    // specifiers. `unshift` for everything-non-named breaks `import * as ns, Bar`
    // (namespace before existing default → reparse failure).
    if (t.isImportDefaultSpecifier(fresh)) {
      existing.specifiers.unshift(fresh);
    } else if (t.isImportNamespaceSpecifier(fresh)) {
      // Insert after any default specifier but before named ones.
      const defaultIdx = existing.specifiers.findIndex((s) => t.isImportDefaultSpecifier(s));
      existing.specifiers.splice(defaultIdx + 1, 0, fresh);
    } else {
      existing.specifiers.push(fresh);
    }
    return { kind: 'added', sourceValue: newSourceValue };
  }

  // Create a new declaration. Insert after the last existing import.
  const decl = t.importDeclaration([fresh], t.stringLiteral(newSourceValue));
  // Preserve type-only imports for `verbatimModuleSyntax` projects.
  decl.importKind = declImportKind;
  let lastImportIndex = -1;
  for (let i = 0; i < targetAst.program.body.length; i++) {
    if (t.isImportDeclaration(targetAst.program.body[i])) lastImportIndex = i;
  }
  targetAst.program.body.splice(lastImportIndex + 1, 0, decl);
  return { kind: 'added', sourceValue: newSourceValue };
}

/**
 * ES module imports forbid certain specifier combinations on a single
 * declaration:
 *   - At most ONE default specifier per declaration.
 *   - A namespace specifier (`* as ns`) cannot coexist with named specifiers
 *     (`{ Foo }`) on the same declaration. (It CAN coexist with a single
 *     default specifier: `import Foo, * as ns from './x'` is legal.)
 *   - Two namespace specifiers on one declaration are illegal.
 *
 * If merging would violate any of these, fall back to emitting a fresh
 * declaration. Without this guard, recast prints `import Foo, Bar from './x'`
 * (two defaults) or `import * as ns, { Foo } from './x'` (namespace + named) —
 * both reparse-failures that corrupt the target file.
 */
function canMergeIntoDeclaration(
  existing: t.ImportDeclaration,
  fresh: t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier,
): boolean {
  const hasDefault = existing.specifiers.some((s) => t.isImportDefaultSpecifier(s));
  const hasNamespace = existing.specifiers.some((s) => t.isImportNamespaceSpecifier(s));
  const hasNamed = existing.specifiers.some((s) => t.isImportSpecifier(s));

  if (t.isImportDefaultSpecifier(fresh)) {
    // Two defaults are illegal.
    return !hasDefault;
  }
  if (t.isImportNamespaceSpecifier(fresh)) {
    // Namespace cannot coexist with another namespace or with named specifiers.
    return !hasNamespace && !hasNamed;
  }
  // fresh is a named specifier.
  return !hasNamespace;
}

function cloneSpecifier(
  spec: t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier,
): t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier {
  if (t.isImportSpecifier(spec)) {
    const importedName = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
    const cloned = t.importSpecifier(t.identifier(spec.local.name), t.identifier(importedName));
    // Preserve `import { type Foo }` inline-type-specifier shape.
    if (spec.importKind) cloned.importKind = spec.importKind;
    return cloned;
  }
  if (t.isImportDefaultSpecifier(spec)) {
    return t.importDefaultSpecifier(t.identifier(spec.local.name));
  }
  return t.importNamespaceSpecifier(t.identifier(spec.local.name));
}

/**
 * Rewrite an import source path to be valid from `targetFilePath`.
 *
 * Relative paths (`./foo`, `../bar`) are resolved against the source file's
 * directory and recomputed relative to the target file's directory.
 *
 * Bare specifiers (`react`, `lodash/fp`) and alias paths (`@/lib/x`, `~/foo`)
 * pass through unchanged — they don't depend on file location.
 */
export function rewriteImportSource(sourceImport: string, sourceFilePath: string, targetFilePath: string): string {
  if (!sourceImport.startsWith('.')) {
    // Bare or alias specifier — file-location independent.
    return sourceImport;
  }
  const sourceDir = nodePath.dirname(sourceFilePath);
  const targetDir = nodePath.dirname(targetFilePath);
  const absoluteImport = nodePath.resolve(sourceDir, sourceImport);
  let rel = nodePath.relative(targetDir, absoluteImport);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel.replace(/\\/g, '/');
}

/**
 * After a cut, walk `ast` and remove import specifiers whose local names are
 * no longer referenced anywhere outside import declarations themselves.
 * If a declaration ends up with zero specifiers, drop the declaration too.
 *
 * Returns the local names of every specifier that was actually removed
 * (caller uses these for the `adjustments` log).
 */
export function pruneOrphanImports(ast: t.File): string[] {
  // First pass: collect every Identifier name referenced anywhere outside an
  // ImportDeclaration. Cheap to be inclusive — false positives just keep an
  // import alive, never the other way around.
  const live = new Set<string>();
  traverse(ast, {
    ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
      // Don't descend; specifiers' local Identifier nodes shouldn't count as
      // references to themselves.
      path.skip();
    },
    Identifier(path: NodePath<t.Identifier>) {
      const parent = path.parent;
      if (t.isMemberExpression(parent) && parent.property === path.node && !parent.computed) {
        return; // member property — not a reference to a top-level binding
      }
      if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) {
        return; // object literal key
      }
      live.add(path.node.name);
    },
    JSXIdentifier(path: NodePath<t.JSXIdentifier>) {
      const parent = path.parent;
      // Element opening/closing names — root identifier is a reference.
      if ((t.isJSXOpeningElement(parent) || t.isJSXClosingElement(parent)) && parent.name === path.node) {
        live.add(path.node.name);
      }
      // Member expression root (e.g. <motion.div>): only the leftmost matters.
      if (t.isJSXMemberExpression(parent) && parent.object === path.node) {
        live.add(path.node.name);
      }
    },
  });

  // Second pass: prune.
  const removed: string[] = [];
  const body = ast.program.body;
  for (let i = body.length - 1; i >= 0; i--) {
    const node = body[i];
    if (!t.isImportDeclaration(node)) continue;
    // Side-effect-only imports (`import './setup.css'`, `import 'reflect-metadata'`)
    // have no specifiers to begin with — never prune them. They run for their
    // side effects and don't bind any names we could detect as dead.
    if (node.specifiers.length === 0) continue;
    const before = node.specifiers.length;
    node.specifiers = node.specifiers.filter((spec) => {
      if (live.has(spec.local.name)) return true;
      removed.push(spec.local.name);
      return false;
    });
    // Drop the declaration only if it HAD specifiers and we removed all of
    // them — empty-from-the-start side-effect imports are preserved by the
    // `continue` above.
    if (before > 0 && node.specifiers.length === 0) {
      body.splice(i, 1);
    }
  }
  return removed;
}
