/** Exercises the router's deferred font correction with deterministic browser primitives. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

for (const cancel of [true, false]) {
  test(`font readiness ${cancel ? 'respects cancellation' : 'still corrects an active target'}`, async () => {
    let ready!: () => void;
    const fonts = {
      ready: new Promise<void>((resolve) => {
        ready = resolve;
      }),
    };
    const moves: number[] = [];
    const style = { scrollBehavior: 'smooth' };
    const source = readFileSync(new URL('../src/lib/router.ts', import.meta.url), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const scope = vm.createContext({
      exports: {},
      require: () => ({}),
      document: { fonts, documentElement: { style } },
      window: { setTimeout: () => 1, scrollBy: ({ top }: { top: number }) => moves.push(top) },
      clearTimeout: () => {},
    });
    new vm.Script(js).runInContext(scope);
    vm.runInContext(
      'globalThis.cancel = exports.scrollToElement(() => ({ getBoundingClientRect: () => ({ top: 1000 }) }), { line: 80 })',
      scope,
    );
    if (cancel) vm.runInContext('cancel(); cancel()', scope);
    ready();
    await fonts.ready;
    await Promise.resolve();
    assert.deepEqual(moves, cancel ? [] : [920]);
    vm.runInContext('cancel()', scope);
    assert.equal(style.scrollBehavior, 'smooth');
  });
}
