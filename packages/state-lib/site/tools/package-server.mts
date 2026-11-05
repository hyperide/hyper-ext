/** Materialize runtime dependencies inside the prebuilt function, not Bun cache mappings. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { assertPackageName, assertOnlyPgMappings } from './package-server-contract.mjs';
const root = resolve('.');
const target = resolve('.vercel/output/functions/api/measurements.func');
const configPath = join(target, '.vc-config.json');
if (!existsSync(configPath)) throw new Error('Build the Vercel measurements function first');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.handler !== 'api/measurements.mjs' || !String(config.runtime).startsWith('nodejs'))
  throw new Error('Unexpected server artifact');
assertOnlyPgMappings(config.filePathMap);
const copied: Array<{ name: string; version: string }> = [];
function packageRoot(name: string, from: string): string {
  const require = createRequire(join(from, 'package.json'));
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    let current = dirname(require.resolve(name));
    while (current !== dirname(current)) {
      const manifest = join(current, 'package.json');
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return current;
      current = dirname(current);
    }
    throw new Error(`Cannot locate dependency ${name}`);
  }
}
function copyDependency(name: string, from: string, parent: string, ancestors: Map<string, string>) {
  assertPackageName(name);
  const source = realpathSync(packageRoot(name, from));
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  if (ancestors.get(name) === manifest.version) return;
  if (copied.length >= 128) throw new Error('Unexpected dependency graph size');
  const destination = resolve(parent, 'node_modules', name);
  if (!destination.startsWith(target + sep)) throw new Error('Dependency destination leaves function');
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (path) => path === source || basename(path) !== 'node_modules',
  });
  copied.push({ name, version: manifest.version });
  const next = new Map(ancestors);
  next.set(name, manifest.version);
  for (const dependency of Object.keys(manifest.dependencies ?? {}))
    copyDependency(dependency, source, destination, next);
}
copyDependency('pg', root, target, new Map());
// The known pg mappings are now satisfied by a self-contained JS driver tree.
// Optional pg-native is not used by this service's pg.Pool configuration.
delete config.filePathMap;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
writeFileSync(join(target, 'dependency-inventory.json'), `${JSON.stringify(copied, null, 2)}\n`);
console.log(`Packaged ${copied.length} JavaScript dependency instances inside the measurements function.`);
