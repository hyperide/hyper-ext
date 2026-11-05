import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { apiSymbolName } from './api-symbol-name.mts';
const dir = mkdtempSync(join(tmpdir(), 'state-api-symbol-'));
function propertiesOf(fixture: string, interfaceName: string, file: string): ts.Symbol[] {
  const path = join(dir, file);
  writeFileSync(path, fixture);
  const program = ts.createProgram([path], { target: ts.ScriptTarget.ES2022 });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(path)!;
  const declaration = source.statements.find(
    (s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === interfaceName,
  );
  if (!declaration) throw new Error(`interface ${interfaceName} not found in ${path}`);
  return checker.getTypeAtLocation(declaration.name).getProperties();
}
try {
  const subjectFixture = (count: number) =>
    `${'interface Warm { [Symbol.asyncIterator](): AsyncIterator<string> }\n'.repeat(count)}interface Subject { normal(): void; [Symbol.iterator](): Iterator<string>; readonly [Symbol.toStringTag]: string; }`;
  const names: string[][] = [];
  for (const count of [0, 9]) {
    const properties = propertiesOf(subjectFixture(count), 'Subject', `sample-${count}.ts`);
    assert(
      properties.some((p) => /^__@iterator@\d+$/.test(p.getName())),
      'exercise actual allocated compiler symbols',
    );
    names.push(properties.map(apiSymbolName).sort());
  }
  assert.deepEqual(names[0], ['[Symbol.iterator]', '[Symbol.toStringTag]', 'normal']);
  assert.deepEqual(names[0], names[1]);
  console.info('PASS: computed API names are declaration-derived and independent of compiler allocation IDs');
  const ordinary = propertiesOf(
    'interface Ordinary { "__@iterator@999": string; normal: number; [Symbol.iterator](): Iterator<string>; }',
    'Ordinary',
    'sample-ordinary.ts',
  ).map(apiSymbolName);
  assert.deepEqual(
    ordinary.sort(),
    ['[Symbol.iterator]', '__@iterator@999', 'normal'],
    'an ordinary property whose name resembles a compiler ID keeps its declared (unquoted) spelling',
  );
  console.info('PASS: ordinary property names resembling internal IDs keep their declared names');
  // A declaration-less symbol with an unstable-looking name is a transient
  // checker artifact and must fail closed rather than emit an unstable key.
  const orphan = {
    getName: () => '__@transient@7',
    getDeclarations: () => undefined,
  } as Pick<ts.Symbol, 'getName' | 'getDeclarations'> as ts.Symbol;
  assert.throws(() => apiSymbolName(orphan), /unstable compiler symbol/);
  console.info('PASS: declaration-less compiler symbols still fail closed');
  // An escaped spelling of the same lookalike must emit the literal value,
  // not the source text: the computed branch above returns raw `getText()`,
  // this branch must not.
  const escaped = propertiesOf(
    'interface Escaped { "__@iter\\u0061tor@1": string; }',
    'Escaped',
    'sample-escaped.ts',
  ).map(apiSymbolName);
  assert.deepEqual(
    escaped,
    ['__@iterator@1'],
    'an escaped spelling of the lookalike emits the literal value, not source text',
  );
  console.info('PASS: escaped lookalike names emit the literal value, not source text');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
