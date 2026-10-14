/**
 * Node regressions for the independent npm extension tree, run by security CI.
 * Resolve through real consumers so a safe root dependency cannot mask an unsafe
 * extension copy. The shared corpus/depth fixture records the audited fork limits.
 */
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { readFileSync, readdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { test } = require('node:test');

const extension = createRequire(resolve(__dirname, '../package.json'));
const tailwind = createRequire(extension.resolve('tailwindcss'));
const glob = createRequire(tailwind.resolve('fast-glob'));
const micromatch = createRequire(glob.resolve('micromatch'));
const bracesPath = micromatch.resolve('braces');
const fixture = resolve(__dirname, '../../../server/lib/__tests__/fixtures/braces-security.cjs');

test('both extension fork copies match every file in the audited root artifact', () => {
  const rootFork = resolve(__dirname, '../../../node_modules/braces');
  const chokidar = createRequire(tailwind.resolve('chokidar'));
  for (const consumer of [micromatch, chokidar]) {
    const copy = dirname(consumer.resolve('braces/package.json'));
    function compare(relative = '') {
      const entries = readdirSync(join(rootFork, relative), { withFileTypes: true });
      assert.deepEqual(readdirSync(join(copy, relative)).sort(), entries.map((entry) => entry.name).sort());
      for (const entry of entries) {
        const file = join(relative, entry.name);
        if (entry.isDirectory()) compare(file);
        else assert.deepEqual(readFileSync(join(copy, file)), readFileSync(join(rootFork, file)), file);
      }
    }
    compare();
  }
});

test('extension glob consumer uses the audited exact fork', () => {
  const manifest = micromatch('braces/package.json');
  assert.equal(manifest.name, '@zklogic/braces');
  assert.equal(manifest.version, '3.0.7');
});

test('extension braces bounds hostile patterns on the Node stack', () => {
  const result = spawnSync(process.execPath, [fixture, bracesPath, 'depth'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('extension fork matches the retained 1820-row upstream compatibility corpus', () => {
  const result = spawnSync(process.execPath, [fixture, bracesPath, 'corpus'], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const expected = JSON.parse(readFileSync(resolve(dirname(fixture), 'braces-compatibility.json'), 'utf8'));
  assert.equal(expected.length, 1820);
  assert.deepEqual(JSON.parse(result.stdout), expected);
});

test('extension micromatch preserves ordinary glob matching', () => {
  assert.deepEqual(micromatch('micromatch')(['a.ts', 'b.tsx', 'c.js'], '*.{ts,tsx}'), ['a.ts', 'b.tsx']);
});

test('proxy-addr rejects IPv4 addresses outside a mapped IPv6 trust subnet', () => {
  const sdk = createRequire(extension.resolve('@modelcontextprotocol/sdk/server/index.js'));
  const express = createRequire(sdk.resolve('express'));
  const proxyaddr = express('proxy-addr');
  const trust = proxyaddr.compile(['::ffff:127.0.0.1/128']);
  assert.equal(trust('127.0.0.1'), true);
  assert.equal(trust('8.8.8.8'), false);
  for (const subnets of [['::ffff:127.0.0.1/80'], ['::ffff:127.0.0.1/80', '192.168.0.0/16']]) {
    const broad = proxyaddr.compile(subnets);
    assert.equal(broad('8.8.8.8'), false);
    assert.equal(broad('::ffff:8.8.8.8'), false);
  }
});
