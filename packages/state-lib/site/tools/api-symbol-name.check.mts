import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { apiSymbolName } from './api-symbol-name.mts';
const dir = mkdtempSync(join(tmpdir(), 'state-api-symbol-'));
try {
  const names: string[][] = [];
  for (const count of [0, 9]) {
    const path = join(dir, `sample-${count}.ts`);
    writeFileSync(
      path,
      `${'interface Warm { [Symbol.asyncIterator](): AsyncIterator<string> }\n'.repeat(count)}interface Subject { normal(): void; [Symbol.iterator](): Iterator<string>; readonly [Symbol.toStringTag]: string; }`,
    );
    const program = ts.createProgram([path], { target: ts.ScriptTarget.ES2022 });
    const checker = program.getTypeChecker(),
      source = program.getSourceFile(path)!;
    const declaration = source.statements.find(
      (s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'Subject',
    )!;
    const properties = checker.getTypeAtLocation(declaration.name).getProperties();
    assert(
      properties.some((p) => /^__@iterator@\d+$/.test(p.getName())),
      'exercise actual allocated compiler symbols',
    );
    names.push(properties.map(apiSymbolName).sort());
  }
  assert.deepEqual(names[0], ['[Symbol.iterator]', '[Symbol.toStringTag]', 'normal']);
  assert.deepEqual(names[0], names[1]);
  console.info('PASS: computed API names are declaration-derived and independent of compiler allocation IDs');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
