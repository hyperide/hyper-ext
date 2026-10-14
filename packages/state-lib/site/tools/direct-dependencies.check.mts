import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }));
const imports = new Map<string, Set<string>>();
function record(specifier: string, path: string): void {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return;
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  const files = imports.get(name) ?? new Set<string>();
  files.add(path);
  imports.set(name, files);
}
function scan(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(path);
      continue;
    }
    if (!/\.[cm]?tsx?$/.test(entry.name)) continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        record(node.moduleSpecifier.text, path);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        record(node.arguments[0].text, path);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
scan(join(root, 'src'));
function missing(packages: Set<string>): string[] {
  return [...imports.keys()].filter((name) => !packages.has(name)).sort();
}
assert.deepEqual(
  missing(declared),
  [],
  `Source imports must be declared directly: ${JSON.stringify([...imports].map(([name, paths]) => [name, [...paths]]))}`,
);
// The pre-fix manifest must fail even on installers that hoist transitive packages.
const beforeFix = new Set(declared);
beforeFix.delete('@lezer/highlight');
assert(missing(beforeFix).includes('@lezer/highlight'));
console.info('source imports resolve through declared direct dependencies; missing Lezer regression detected');
