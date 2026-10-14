import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const RUNTIME_PUBLIC_ENTRY = '../../runtime/src/index.js';
const PRODUCTION_MODULES = ['async-resource.ts', 'match-async-state.ts', 'index.ts'];
const TESTING_MODULES = ['async-conformance.ts', 'testing.ts'];
const HEADLESS_MODULES = [...PRODUCTION_MODULES, ...TESTING_MODULES];

const FORBIDDEN_IMPORTS = [
  'react',
  'react-dom',
  'vue',
  'svelte',
  'solid-js',
  '@angular',
  'lit',
  'qwik',
  '@tanstack',
  'rxjs',
  'dexie',
  'idb',
  'react-router',
  'vue-router',
  'zustand',
  'jotai',
  'valtio',
];

const FORBIDDEN_GLOBALS = ['window', 'document', 'localStorage', 'indexedDB', 'navigator', 'location'];

function codeImports(source: string): string[] {
  const found: string[] = [];
  const pattern = /^\s*import\s+(?!type\b)[^'"]*from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    found.push(match[1] ?? match[2] ?? '');
  }
  return found.filter((spec) => spec.length !== 0);
}

function codeReexports(source: string): string[] {
  const found: string[] = [];
  const pattern = /^\s*export\s+(?:type\s+)?(?:\*|{[^}]*})\s*from\s*['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    found.push(match[1] ?? '');
  }
  return found.filter((spec) => spec.length !== 0);
}

function specToFile(spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const target = resolve(here, spec);
  const toolkitRoot = resolve(here, '.');
  if (!target.startsWith(toolkitRoot)) return undefined;
  if (target.endsWith('.js')) {
    const ts = `${target.slice(0, -3)}.ts`;
    if (existsSync(ts)) return ts;
  }
  if (existsSync(target)) return target;
  return undefined;
}

/** Transitive closure of toolkit files reachable from an entrypoint,
 * following both `import ... from` and `export ... from` edges. */
function reachableFiles(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [join(here, entry)];
  while (queue.length !== 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const spec of [...codeImports(source), ...codeReexports(source)]) {
      const next = specToFile(spec);
      if (next !== undefined && next.endsWith('.ts')) queue.push(next);
    }
  }
  return seen;
}

test('headless modules import only the public runtime entrypoint, never frameworks or SDKs', () => {
  for (const module of HEADLESS_MODULES) {
    const source = readFileSync(join(here, module), 'utf8');
    for (const spec of codeImports(source)) {
      assert.ok(
        !FORBIDDEN_IMPORTS.some((banned) => spec === banned || spec.startsWith(`${banned}/`)),
        `${module} must not import a framework or data SDK (found ${spec})`,
      );
      if (spec.startsWith('.')) {
        const target = resolve(here, spec);
        assert.ok(
          target.startsWith(resolve(here, '.')) || target === resolve(here, RUNTIME_PUBLIC_ENTRY),
          `${module} must not reach outside the toolkit except via ${RUNTIME_PUBLIC_ENTRY} (found ${spec})`,
        );
      } else if (!spec.startsWith('node:')) {
        assert.fail(`${module} has an unexpected bare import ${spec}`);
      }
    }
    for (const global of FORBIDDEN_GLOBALS) {
      const hit = new RegExp(`\\b${global}\\b`).test(source);
      assert.equal(hit, false, `${module} must not touch environment global ${global}`);
    }
  }
});

test('every headless module exists in this pilot', () => {
  const files = new Set(readdirSync(here));
  for (const module of HEADLESS_MODULES) {
    assert.equal(files.has(module), true, `missing headless module ${module}`);
  }
});

test('the production entrypoint never re-exports the node testing harness', () => {
  const entry = readFileSync(join(here, 'index.ts'), 'utf8');
  assert.equal(
    entry.includes('async-conformance'),
    false,
    'index.ts must not re-export the conformance testing harness; use the testing entrypoint instead',
  );
});

test('the testing entrypoint exposes the conformance suite', () => {
  const testing = readFileSync(join(here, 'testing.ts'), 'utf8');
  assert.equal(
    testing.includes('async-conformance'),
    true,
    'testing.ts must re-export the conformance suite for test runners',
  );
});

test('the production entry closure is browser-safe: no node/framework/env imports, transitively', () => {
  const closure = reachableFiles('index.ts');
  const names = new Set([...closure].map((file) => file.slice(resolve(here, '.').length + 1)));
  for (const module of PRODUCTION_MODULES) {
    assert.ok(names.has(module), `production closure must contain ${module}`);
  }
  assert.ok(!names.has('async-conformance.ts'), 'production closure must not reach async-conformance.ts');
  assert.ok(!names.has('testing.ts'), 'production closure must not reach testing.ts');
  for (const file of closure) {
    const source = readFileSync(file, 'utf8');
    const short = file.slice(resolve(here, '.').length + 1);
    for (const spec of [...codeImports(source), ...codeReexports(source)]) {
      assert.ok(
        !FORBIDDEN_IMPORTS.some((banned) => spec === banned || spec.startsWith(`${banned}/`)),
        `${short} must not import a framework or data SDK, transitively (found ${spec})`,
      );
      assert.ok(!spec.startsWith('node:'), `${short} must not import ${spec}: production code is browser-safe`);
    }
    for (const global of FORBIDDEN_GLOBALS) {
      const hit = new RegExp(`\\b${global}\\b`).test(source);
      assert.equal(hit, false, `${short} must not touch environment global ${global}, transitively`);
    }
  }
});
