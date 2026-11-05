/** Packaging must replace metadata links planted while dependencies are copied. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'state-package-race-')));
try {
  const target = join(temporary, '.vercel/output/functions/api/measurements.func');
  const driver = join(temporary, 'node_modules/pg');
  mkdirSync(target, { recursive: true });
  mkdirSync(driver, { recursive: true });
  const original = {
    handler: 'api/measurements.mjs',
    runtime: 'nodejs22.x',
    filePathMap: { 'node_modules/pg': 'node_modules/pg' },
  };
  const configPath = join(target, '.vc-config.json');
  writeFileSync(configPath, JSON.stringify(original));
  writeFileSync(join(driver, 'package.json'), JSON.stringify({ name: 'pg', version: '1.0.0' }));
  const protectedPath = join(temporary, 'unrelated.json');
  const protectedInventoryPath = join(temporary, 'unrelated-inventory.json');
  writeFileSync(protectedPath, 'unrelated contents\n');
  writeFileSync(protectedInventoryPath, 'unrelated inventory contents\n');
  const markerPath = join(temporary, 'metadata-links-planted.json');
  const preload = join(temporary, 'replace-config.mjs');
  writeFileSync(
    preload,
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
const configPath = resolve('.vercel/output/functions/api/measurements.func/.vc-config.json');
const protectedPath = resolve('unrelated.json');
const inventoryPath = resolve('.vercel/output/functions/api/measurements.func/dependency-inventory.json');
const protectedInventoryPath = resolve('unrelated-inventory.json');
const markerPath = resolve('metadata-links-planted.json');
const copy = fs.cpSync;
let replaced = false;
fs.cpSync = (...args) => {
  if (!replaced) {
    replaced = true;
    fs.unlinkSync(configPath);
    fs.symlinkSync(protectedPath, configPath);
    fs.symlinkSync(protectedInventoryPath, inventoryPath);
    fs.writeFileSync(markerPath, JSON.stringify([configPath, inventoryPath]));
  }
  return copy(...args);
};
syncBuiltinESMExports();
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      ...process.execArgv.map((argument) => (argument === 'tsx' ? import.meta.resolve('tsx') : argument)),
      '--import',
      pathToFileURL(preload).href,
      fileURLToPath(new URL('./package-server.mts', import.meta.url)),
    ],
    { cwd: temporary, encoding: 'utf8', timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const inventoryPath = join(target, 'dependency-inventory.json');
  assert.deepEqual(
    JSON.parse(readFileSync(markerPath, 'utf8')),
    [configPath, inventoryPath],
    'The injected race must actually replace both metadata paths',
  );
  assert.equal(
    readFileSync(protectedPath, 'utf8'),
    'unrelated contents\n',
    'A replaced config path must not redirect writes',
  );
  assert.equal(
    readFileSync(protectedInventoryPath, 'utf8'),
    'unrelated inventory contents\n',
    'A replaced inventory path must not redirect writes',
  );
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    handler: 'api/measurements.mjs',
    runtime: 'nodejs22.x',
  });
  assert.deepEqual(JSON.parse(readFileSync(inventoryPath, 'utf8')), [{ name: 'pg', version: '1.0.0' }]);
  assert.equal(lstatSync(configPath).isSymbolicLink(), false, 'The packaged config must replace the substituted link');
  assert.equal(
    lstatSync(inventoryPath).isSymbolicLink(),
    false,
    'The packaged inventory must replace the substituted link',
  );
  assert.equal(
    readdirSync(target).some((name) => name.startsWith('.metadata-')),
    false,
    'No temporary metadata directory remains',
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log(
  'PASS: planted config and inventory links cannot redirect metadata writes; the artifact stays self-contained',
);
