/**
 * Direct unit tests for the cross-file move bookkeeping helpers in
 * `jsx-deps.ts`. These cover branches the AstService integration tests don't
 * exercise (side-effect imports, type-only imports, name-collision adjustments,
 * multi-up relative path rewrites, JSXMemberExpression keep-alive).
 */

import { describe, expect, it } from 'bun:test';
import * as t from '@babel/types';
import {
  collectJsxExternalRefs,
  collectJsxLocalBindings,
  findImportForName,
  type ImportSpecifierInfo,
  pruneOrphanImports,
  replicateImport,
  rewriteImportSource,
} from './jsx-deps';
import { parseCode, printAST } from './parser';

function findImportInfo(ast: t.File, name: string): ImportSpecifierInfo {
  const info = findImportForName(ast, name);
  if (!info) throw new Error(`fixture missing import for '${name}'`);
  return info;
}

function firstJsxElement(ast: t.File): t.JSXElement {
  for (const stmt of ast.program.body) {
    if (t.isExpressionStatement(stmt) && t.isJSXElement(stmt.expression)) return stmt.expression;
    if (t.isVariableDeclaration(stmt)) {
      for (const d of stmt.declarations) {
        if (d.init && t.isJSXElement(d.init)) return d.init;
      }
    }
  }
  throw new Error('no JSXElement found in fixture');
}

describe('rewriteImportSource', () => {
  it('passes bare specifiers through unchanged', () => {
    expect(rewriteImportSource('react', '/w/src/A.tsx', '/w/src/B.tsx')).toBe('react');
    expect(rewriteImportSource('lodash/fp', '/w/src/A.tsx', '/w/src/B.tsx')).toBe('lodash/fp');
  });

  it('passes alias specifiers through unchanged', () => {
    expect(rewriteImportSource('@/lib/utils', '/w/src/A.tsx', '/w/src/B.tsx')).toBe('@/lib/utils');
    expect(rewriteImportSource('~/styles', '/w/src/A.tsx', '/w/src/pages/B.tsx')).toBe('~/styles');
  });

  it('rewrites relative path when source/target sit at different depths', () => {
    // source = src/pages/Page.tsx, target = src/components/cards/Card.tsx,
    // import was './Helper' (= src/pages/Helper)
    const result = rewriteImportSource('./Helper', '/w/src/pages/Page.tsx', '/w/src/components/cards/Card.tsx');
    expect(result).toBe('../../pages/Helper');
  });

  it('rewrites parent-relative paths', () => {
    // source = src/components/A.tsx imports '../utils' (= src/utils),
    // moved into src/pages/sub/B.tsx — should resolve to '../../utils'
    const result = rewriteImportSource('../utils', '/w/src/components/A.tsx', '/w/src/pages/sub/B.tsx');
    expect(result).toBe('../../utils');
  });

  it('produces ./ prefix for same-dir target', () => {
    const result = rewriteImportSource('./sibling', '/w/src/A.tsx', '/w/src/B.tsx');
    expect(result).toBe('./sibling');
  });
});

describe('replicateImport — importKind preservation', () => {
  it('preserves type-only declaration importKind', () => {
    const sourceAst = parseCode("import type { Foo } from './foo';\nimport { Bar } from './bar';\n");
    const targetAst = parseCode("import { Existing } from './existing';\n");

    const fooInfo = findImportInfo(sourceAst, 'Foo');
    expect(fooInfo.declaration.importKind).toBe('type');

    const result = replicateImport(targetAst, fooInfo, '/w/src/A.tsx', '/w/src/B.tsx');
    expect(result.kind).toBe('added');

    const printed = printAST(targetAst);
    expect(printed).toContain('import type { Foo }');
  });

  it('preserves inline `import { type Foo, Bar }` specifier shape', () => {
    const sourceAst = parseCode("import { type Foo, Bar } from './both';\n");
    const targetAst = parseCode('');
    const fooInfo = findImportInfo(sourceAst, 'Foo');
    replicateImport(targetAst, fooInfo, '/w/src/A.tsx', '/w/src/B.tsx');

    const printed = printAST(targetAst);
    expect(printed).toContain('type Foo');
  });
});

describe('replicateImport — name collision adjustments', () => {
  it('returns "collision" when target imports the same local name from a different module', () => {
    const sourceAst = parseCode("import { Foo } from './source-foo';\n");
    const targetAst = parseCode("import { Foo } from './target-foo';\n");
    const info = findImportInfo(sourceAst, 'Foo');

    const result = replicateImport(targetAst, info, '/w/src/A.tsx', '/w/src/B.tsx');

    expect(result.kind).toBe('collision');
    if (result.kind === 'collision') {
      expect(result.existingSourceValue).toBe('./target-foo');
      expect(result.expectedSourceValue).toBe('./source-foo');
    }
    // Target's existing import is NOT clobbered.
    expect(printAST(targetAst)).toContain("import { Foo } from './target-foo'");
  });

  it('returns "already-present" when target imports same name from same module', () => {
    const sourceAst = parseCode("import { Foo } from './foo';\n");
    const targetAst = parseCode("import { Foo } from './foo';\n");
    const info = findImportInfo(sourceAst, 'Foo');

    const result = replicateImport(targetAst, info, '/w/src/A.tsx', '/w/src/B.tsx');
    expect(result.kind).toBe('already-present');
  });
});

describe('replicateImport — does not merge across importKind', () => {
  it('keeps `import type {}` and `import {}` from same module on separate declarations', () => {
    const sourceAst = parseCode("import type { Foo } from './shared';\n");
    const targetAst = parseCode("import { Bar } from './shared';\n");
    const info = findImportInfo(sourceAst, 'Foo');

    const result = replicateImport(targetAst, info, '/w/src/A.tsx', '/w/src/B.tsx');
    expect(result.kind).toBe('added');

    const printed = printAST(targetAst);
    // Recast's printer emits double quotes for newly-constructed imports
    // and single quotes for the pre-existing one — we don't care about
    // quote style, just that both shapes survived as separate decls.
    expect(printed).toMatch(/import type \{ Foo \} from ['"]\.\/shared['"]/);
    expect(printed).toMatch(/import \{ Bar \} from ['"]\.\/shared['"]/);
    // Make sure they're not on one line / not merged.
    expect(printed).not.toContain('import type { Foo }, { Bar }');
  });
});

describe('pruneOrphanImports — side-effect imports', () => {
  it('does NOT drop side-effect-only imports (`import "./styles.css"`)', () => {
    const ast = parseCode(`
import './styles.css';
import 'reflect-metadata';
import { Used } from './lib';
const _x = Used;
`);
    const removed = pruneOrphanImports(ast);
    expect(removed).toEqual([]);

    const printed = printAST(ast);
    expect(printed).toContain("import './styles.css'");
    expect(printed).toContain("import 'reflect-metadata'");
    expect(printed).toContain("import { Used } from './lib'");
  });

  it('drops imports whose every specifier is dead, but spares side-effect imports', () => {
    const ast = parseCode(`
import './global.css';
import { Dead, Alive } from './things';
const _x = Alive;
`);
    const removed = pruneOrphanImports(ast);
    expect(removed).toContain('Dead');
    expect(removed).not.toContain('Alive');
    const printed = printAST(ast);
    expect(printed).toContain("import './global.css'");
    expect(printed).toContain("import { Alive } from './things'");
    expect(printed).not.toContain('Dead');
  });
});

describe('pruneOrphanImports — JSXMemberExpression keep-alive', () => {
  it('keeps `motion` alive when the only reference is `<motion.div>`', () => {
    const ast = parseCode(`
import { motion } from 'framer-motion';
const x = <motion.div />;
`);
    const removed = pruneOrphanImports(ast);
    expect(removed).toEqual([]);
    expect(printAST(ast)).toContain("import { motion } from 'framer-motion'");
  });
});

describe('collectJsxExternalRefs', () => {
  it('emits PascalCase tag and member-expression root', () => {
    const ast = parseCode('const x = <motion.div className="root"><Foo /></motion.div>;');
    const root = firstJsxElement(ast);
    const refs = collectJsxExternalRefs(root);
    expect(refs.has('motion')).toBe(true);
    expect(refs.has('Foo')).toBe(true);
    // Lower-case host tags excluded.
    expect(refs.has('div')).toBe(false);
  });

  it('walks JSXSpreadAttribute identifiers', () => {
    const ast = parseCode('const x = <Foo {...rest} />;');
    const root = firstJsxElement(ast);
    const refs = collectJsxExternalRefs(root);
    expect(refs.has('Foo')).toBe(true);
    expect(refs.has('rest')).toBe(true);
  });

  it('walks expression-slot identifiers', () => {
    const ast = parseCode('const x = <div>{count + 1}</div>;');
    const root = firstJsxElement(ast);
    const refs = collectJsxExternalRefs(root);
    expect(refs.has('count')).toBe(true);
  });
});

describe('collectJsxLocalBindings', () => {
  it('collects arrow-callback param names', () => {
    const ast = parseCode('const x = <ul>{items.map((item) => <li>{item}</li>)}</ul>;');
    const root = firstJsxElement(ast);
    const bound = collectJsxLocalBindings(root);
    expect(bound.has('item')).toBe(true);
    // `items` is captured from outer scope, NOT bound inside the subtree.
    expect(bound.has('items')).toBe(false);
  });

  it('collects destructured arrow-param names', () => {
    const ast = parseCode('const x = <ul>{rows.map(({ id, label }) => <li key={id}>{label}</li>)}</ul>;');
    const root = firstJsxElement(ast);
    const bound = collectJsxLocalBindings(root);
    expect(bound.has('id')).toBe(true);
    expect(bound.has('label')).toBe(true);
    expect(bound.has('rows')).toBe(false);
  });

  it('collects rest patterns and aliases', () => {
    const ast = parseCode('const x = <div>{xs.map(({ a: aa, ...rest }) => <span>{aa}</span>)}</div>;');
    const root = firstJsxElement(ast);
    const bound = collectJsxLocalBindings(root);
    expect(bound.has('aa')).toBe(true);
    expect(bound.has('rest')).toBe(true);
  });

  it('collects inline VariableDeclarator names from IIFEs', () => {
    const ast = parseCode('const x = <div>{(() => { const local = compute(); return local; })()}</div>;');
    const root = firstJsxElement(ast);
    const bound = collectJsxLocalBindings(root);
    expect(bound.has('local')).toBe(true);
    // `compute` is referenced from outer scope.
    expect(bound.has('compute')).toBe(false);
  });

  it('returns an empty set for a JSX subtree with no inner functions', () => {
    const ast = parseCode('const x = <div className={cls}>{title}</div>;');
    const root = firstJsxElement(ast);
    const bound = collectJsxLocalBindings(root);
    expect(bound.size).toBe(0);
  });
});
