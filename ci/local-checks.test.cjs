/**
 * Drives the real fallback shell from CI prerequisite tests (or node directly).
 * Owned PATH fixtures record only expensive external command boundaries; these
 * checks prove orchestration, not successful execution of the security tools.
 * Guards against application-only tests and silently omitted security gates.
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { test } = require('node:test');

const script = resolve(__dirname, 'local-checks.sh');
const site = 'packages/state-lib/site';
const extension = 'vscode-extension/hypercanvas-preview';
const install = 'bun install --frozen-lockfile --ignore-scripts';
const browsers = 'node node_modules/playwright/cli.js install chromium webkit';

function run({ fail = '', args = [], env = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'local-checks-test-'));
  try {
    for (const directory of ['bin', site, extension, 'home']) mkdirSync(join(root, directory), { recursive: true });
    for (const command of ['bun', 'npm', 'npx', 'node', 'bash', 'git', 'gitleaks', 'semgrep', 'trivy']) {
      writeFileSync(
        join(root, 'bin', command),
        `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = ${JSON.stringify(command)} + ' ' + process.argv.slice(2).join(' ');
fs.appendFileSync(process.env.TRACE, JSON.stringify({ cwd: path.relative(process.env.REPO_ROOT, process.cwd()), command }) + '\\n');
if (command.includes(process.env.FAIL_COMMAND) && process.env.FAIL_COMMAND) {
  console.error(process.env.FAIL_OUTPUT || 'fixture boundary failure');
  process.exit(42);
}
`,
        { mode: 0o755 },
      );
    }
    const result = spawnSync('/bin/bash', [script, ...args], {
      env: {
        ...process.env,
        ...env,
        HOME: join(root, 'home'),
        DOCKER_CONFIG: join(root, 'home'),
        PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
        REPO_ROOT: root,
        TRACE: join(root, 'trace'),
        FAIL_COMMAND: fail,
      },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.error, undefined);
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      calls: readFileSync(join(root, 'trace'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('fallback installs frozen trees and browser engines before types and the complete workspace', () => {
  const result = run();
  assert.equal(result.status, 0, result.output);
  const index = (cwd, command) => {
    const found = result.calls.findIndex((call) => call.cwd === cwd && call.command === command);
    assert.ok(found >= 0, `missing ${cwd}: ${command}`);
    return found;
  };
  const types = index('', 'bun run typecheck');
  const workspace = index('', 'bun run test');
  for (const prerequisite of [index('', install), index(site, install), index(site, browsers)]) {
    assert.ok(prerequisite < types && prerequisite < workspace);
  }
  assert.ok(index(site, install) < index(site, browsers));
  assert.ok(index(extension, 'npm ci --ignore-scripts --include=dev') < workspace);
  assert.ok(
    index(extension, 'npm audit --audit-level=high --include=dev') <
      index(extension, 'node scripts/dependency-security.test.cjs'),
  );
  assert.ok(result.calls.some((call) => call.command.startsWith('node ci/braces-fork-scan.cjs ')));
  index('', 'node ci/braces-fork-scan.test.cjs');
  assert.ok(result.calls.some((call) => call.command.includes('ci/dependency-review/dep-audit.sh')));
  index('', 'semgrep scan --config auto --severity ERROR --error .');
  index(
    '',
    'trivy fs --scanners vuln --severity CRITICAL,HIGH --exit-code 1 --skip-dirs cloned-projects,node_modules,docs,templates .',
  );
  assert.ok(!result.calls.some((call) => call.command.startsWith('npx ')));
});

for (const [fail, status] of [
  ['bun install', 9],
  ['playwright/cli.js install', 9],
  ['node --input-type=module', 9],
  ['bun run typecheck', 1],
  ['bun run test', 3],
  ['npm ci', 9],
  ['npm audit', 7],
  ['node scripts/dependency-security.test.cjs', 7],
  ['trivy fs', 10],
  ['node ci/braces-fork-scan.cjs', 12],
  ['node ci/braces-fork-scan.test.cjs', 12],
  ['node node_modules/typescript/bin/tsc', 4],
  ['node esbuild.js', 4],
]) {
  test(`fallback blocks success on ${fail} failure`, () => {
    const result = run({ fail });
    assert.equal(result.status, status, result.output);
    assert.doesNotMatch(result.output, /All local checks PASSED/);
    assert.ok(result.calls.at(-1).command.includes(fail), 'no later check may mask the failure');
  });
}

test('Trivy operational failure retains its tooling-error category', () => {
  const result = run({ fail: 'trivy fs', env: { FAIL_OUTPUT: 'FATAL database unavailable' } });
  assert.equal(result.status, 9, result.output);
  assert.doesNotMatch(result.output, /All local checks PASSED/);
});

test('skip-ext-build and inherited skip variables cannot bypass tests or security', () => {
  for (const fail of [
    'bun run test',
    'npm audit',
    'node scripts/dependency-security.test.cjs',
    'node ci/braces-fork-scan.cjs',
  ]) {
    const result = run({
      fail,
      args: ['--skip-ext-build'],
      env: { LOCAL_CHECKS_SKIP_EXT_BUILD: '1', NODE_ENV: 'production', npm_config_omit: 'dev' },
    });
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /All local checks PASSED/);
    assert.ok(result.calls.at(-1).command.includes(fail));
  }
});

test('fallback provisions only the site browser engines consumed by the workspace', () => {
  const result = run();
  assert.equal(result.status, 0, result.output);
  assert.equal(
    result.calls.some((call) => call.command.includes('playwright-core/cli.js install')),
    false,
    'do not download a second unused root browser revision',
  );
  assert.ok(result.calls.some((call) => call.cwd === site && call.command === browsers));
  assert.ok(
    result.calls.some((call) => call.command.startsWith('node --input-type=module')),
    'the actual Chromium/WebKit launch prerequisite must remain',
  );
});
