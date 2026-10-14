import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERATED_API } from '../src/lib/api-docs.generated';

test('named string unions show their complete declaration', () => {
  assert.match(GENERATED_API.TaskStatus.sig, /type TaskStatus\s*=/);
  assert.match(GENERATED_API.TaskStatus.sig, /'pending'|"pending"/);
  assert.match(GENERATED_API.CancelReason.sig, /dependency-cancelled/);
});
test('stdlib prototype members are not advertised as state-lib APIs', () => {
  assert.deepEqual(
    Object.keys(GENERATED_API).filter((key) => /^(TaskStatus|CancelReason)\./.test(key)),
    [],
  );
});
test('real store and scope contracts survive the generated surface filter', () => {
  for (const key of ['store.undo', 'store.redo', 'Scope.end', 'TaskContext.signal']) {
    assert(GENERATED_API[key], `Lost actual library member ${key}`);
  }
});

import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPublicApiMember } from './api-public-surface.mts';

test('library inheritance stays visible while native Array methods stay out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-public-api-'));
  try {
    const file = join(dir, 'api.ts');
    writeFileSync(file, 'interface Base { base(): void }\ninterface Child extends Base, Array<number> { own: string }');
    const program = ts.createProgram([file], { target: ts.ScriptTarget.ES2022 });
    const checker = program.getTypeChecker();
    const declaration = program
      .getSourceFile(file)!
      .statements.find(
        (node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === 'Child',
      )!;
    const members = checker.getTypeAtLocation(declaration).getProperties();
    assert(members.some((member) => member.getName() === 'map'));
    assert.deepEqual(
      members
        .filter((member) => isPublicApiMember(member, program))
        .map((member) => member.getName())
        .sort(),
      ['base', 'own'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
