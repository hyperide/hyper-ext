/** Real Chromium acceptance of the exported package pair, not the Hyper inspector. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportPackage } from './export-package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
if (!process.argv[2]) throw new Error('Usage: node check-operation-browser.mjs <new-evidence-directory>');
const out = resolve(process.argv[2]);
mkdirSync(out); // Never overwrite an earlier evidence snapshot.
const scratch = mkdtempSync(join(tmpdir(), 'state-operation-browser-'));
const peer = join(scratch, 'node_modules/@ultrabricks');
mkdirSync(peer, { recursive: true });
await test('exported package authority holds in actual Chromium', async () => {
  let browser;
  try {
    const exported = exportPackage({ dest: join(peer, 'state-toolkit-async') });
    const core = join(peer, 'state-lib');
    mkdirSync(core);
    cpSync(join(root, 'packages/state-lib/runtime/package.json'), join(core, 'package.json'));
    execFileSync(
      'node',
      [
        require.resolve('typescript/lib/tsc.js'),
        '-p',
        join(root, 'packages/state-lib/runtime/tsconfig.build.json'),
        '--outDir',
        join(core, 'dist'),
      ],
      { stdio: 'pipe' },
    );
    const entry = join(scratch, 'entry.js');
    writeFileSync(
      entry,
      "export { Runtime, StateError, NotificationError } from '@ultrabricks/state-lib';\nexport { createOperationScope } from '@ultrabricks/state-toolkit-async';\n",
    );
    const bundle = join(scratch, 'consumer.js');
    const built = await build({
      absWorkingDir: scratch,
      entryPoints: [entry],
      outfile: bundle,
      bundle: true,
      platform: 'browser',
      target: 'es2022',
      format: 'iife',
      globalName: 'StateOperationTest',
      minify: true,
      metafile: true,
      logLevel: 'silent',
    });
    const inputs = Object.keys(built.metafile.inputs);
    assert.ok(inputs.includes('node_modules/@ultrabricks/state-toolkit-async/dist/operation-scope.js'));
    assert.equal(inputs.filter((name) => name.endsWith('/state-lib/dist/core.js')).length, 1, 'one shared core');
    assert.ok(
      inputs.every((name) => name === 'entry.js' || name.includes('/dist/')),
      'only public emitted package files',
    );
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.STATE_CHROME || undefined,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<!doctype html><title>Operation authority package acceptance</title>');
    await page.addScriptTag({ path: bundle });
    const cases = await page.evaluate(async () => {
      const { Runtime, StateError, NotificationError, createOperationScope } = globalThis.StateOperationTest;
      const passed = [];
      const check = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      async function scenario(name, run) {
        const runtime = new Runtime();
        const scope = createOperationScope(runtime, { traceCapacity: 8 });
        try {
          await run(runtime, scope);
          passed.push(name);
        } finally {
          scope.dispose();
          runtime.dispose();
        }
      }
      await scenario('late failure after replacement does not reach current feedback', async (runtime, scope) => {
        const seen = [];
        let fail;
        const remote = new Promise((_, reject) => {
          fail = reject;
        });
        const old = scope.begin('width');
        const finished = remote.catch(old.bind((error) => seen.push(error)));
        const current = scope.begin('width');
        const value = runtime.signal(120);
        current.commit(() => value.set(140));
        fail(new Error('old write'));
        const result = await finished;
        check(result.status === 'dropped' && result.reason === 'superseded', 'stale feedback was not revoked');
        check(seen.length === 0 && value.peek() === 140 && current.current, 'replacement changed');
      });
      await scenario('A to B to A does not revive the first operation', (_runtime, scope) => {
        const old = scope.begin('width');
        scope.advance();
        scope.advance();
        const current = scope.begin('width');
        let called = false;
        const result = old.notify(() => {
          called = true;
        });
        check(
          result.status === 'dropped' && result.reason === 'scope-changed' && !called && current.current,
          'ABA revived authority',
        );
      });
      await scenario('disposed UI retains external completion but rejects its feedback', async (_runtime, scope) => {
        const old = scope.begin('width');
        const seen = [];
        let complete;
        const remote = new Promise((resolve) => {
          complete = resolve;
        });
        const settled = remote.then((value) => ({ value, feedback: old.notify(() => seen.push(value)) }));
        scope.dispose();
        complete('external write happened');
        const result = await settled;
        check(
          result.value === 'external write happened' && result.feedback.status === 'dropped' && seen.length === 0,
          'external outcome was lost or stale UI ran',
        );
      });
      await scenario('independent lanes and old cleanup preserve a newer owner', (_runtime, scope) => {
        const old = scope.begin('width');
        const height = scope.begin('height');
        const next = scope.begin('width');
        old.finish();
        old.cancel();
        check(
          height.current && next.current && scope.diagnostics().activeOperations === 2,
          'independent authority lost',
        );
      });
      await scenario('current feedback keeps argument types at runtime and error identity', (_runtime, scope) => {
        const lease = scope.begin('width');
        const seen = [];
        const report = lease.bind((n, unit) => seen.push(`${n}${unit}`));
        check(report(130, 'px').status === 'applied' && seen[0] === '130px', 'arguments lost');
        const failure = new Error('current failure');
        let caught;
        try {
          lease.notify(() => {
            throw failure;
          });
        } catch (error) {
          caught = error;
        }
        check(caught === failure, 'current error swallowed or replaced');
      });
      await scenario('observer failure remains a committed publication', (runtime, scope) => {
        const value = runtime.signal(0);
        const lease = scope.begin('width');
        const unsubscribe = value.subscribe(() => {
          throw new Error('observer failed');
        });
        let caught;
        try {
          lease.commit(() => value.set(1));
        } catch (error) {
          caught = error;
        }
        check(caught instanceof NotificationError && value.peek() === 1, 'published state was mislabeled');
        check(
          scope.diagnostics().trace.some((event) => event.kind === 'commit-failed' && event.published === true),
          'publication diagnostic missing',
        );
        unsubscribe();
      });
      await scenario('lazy thenable feedback is rejected and assimilated once', async (_runtime, scope) => {
        const lease = scope.begin('width');
        let reads = 0;
        let calls = 0;
        let receiver;
        // oxlint-disable-next-line unicorn/no-thenable -- Deliberate invalid JavaScript feedback in this acceptance test.
        const thenable = Object.defineProperty({}, 'then', {
          get() {
            reads++;
            return function (_resolve, reject) {
              calls++;
              receiver = this;
              reject(new Error('lazy rejected'));
            };
          },
        });
        let caught;
        try {
          lease.notify(() => thenable);
        } catch (error) {
          caught = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        check(caught instanceof StateError && caught.code === 'STATE_ASYNC_FEEDBACK', 'async misuse hidden');
        check(reads === 1 && calls === 1 && receiver === thenable, 'thenable observed more than once');
      });
      await scenario('stale feedback inside a store notification does not fail publication', (runtime, scope) => {
        const operation = scope.begin('width');
        scope.dispose();
        const before = JSON.stringify(scope.diagnostics());
        const source = runtime.signal(0);
        let invoked = false;
        let outcome;
        const stop = source.subscribe(() => {
          outcome = operation.notify(() => {
            invoked = true;
          });
        });
        source.set(1);
        check(!invoked && outcome.status === 'dropped', 'stale subscriber was not inert');
        check(JSON.stringify(scope.diagnostics()) === before, 'notification-phase drop wrote trace');
        stop();
      });
      await scenario('bounded trace and long-lived owner retain no finished operations', (_runtime, scope) => {
        for (let i = 0; i < 10000; i++) scope.begin('private-document-lane').finish();
        const diagnostic = scope.diagnostics();
        check(
          diagnostic.activeOperations === 0 && diagnostic.trace.length === 8 && diagnostic.droppedEvents > 0,
          'unbounded active state or trace',
        );
        check(!JSON.stringify(diagnostic).includes('private-document-lane'), 'private lane entered trace');
      });
      return passed;
    });
    await page.waitForTimeout(25); // Give unhandled-rejection events a browser turn.
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    assert.equal(cases.length, 9);
    const result = {
      schema: 1,
      testScriptSha256: createHash('sha256')
        .update(readFileSync(fileURLToPath(import.meta.url)))
        .digest('hex'),
      at: new Date().toISOString(),
      browser: browser.version(),
      executable: process.env.STATE_CHROME ?? 'playwright-default',
      package: exported.package,
      cases,
      pageErrors: errors,
      consumerBytes: readFileSync(bundle).length,
      consumerSha256: createHash('sha256').update(readFileSync(bundle)).digest('hex'),
      inputs,
      scope:
        'Actual Chromium, emitted package imports, one core. Not real Hyper UI/AST/HMR acceptance or a performance comparison.',
    };
    writeFileSync(join(out, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
    cpSync(join(peer, 'state-toolkit-async/PROVENANCE.json'), join(out, 'package-provenance.json'));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (browser) await browser.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});
