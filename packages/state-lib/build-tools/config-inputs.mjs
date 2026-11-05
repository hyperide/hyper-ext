import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const input = JSON.parse(readFileSync(0, 'utf8'));
if (process.env.ESBUILD_BINARY_PATH)
  throw Error('ESBUILD_BINARY_PATH overrides are not supported by a fingerprinted build');
const root = realpathSync(input.root),
  records = new Map(),
  contents = new Map(),
  roots = new Set();
const inside = (path) => path === root || path.startsWith(root + sep);
function record(path) {
  const absolute = resolve(path);
  if (contents.has(absolute)) return contents.get(absolute);
  if (!inside(absolute) || !inside(realpathSync(absolute)))
    throw Error('Compiler configuration leaves project root: ' + absolute);
  const bytes = readFileSync(absolute);
  if (bytes.length > 4 * 1024 * 1024) throw Error('Compiler configuration exceeds 4 MiB: ' + absolute);
  records.set(absolute, {
    path: relative(root, absolute).split(sep).join('/'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  const text = bytes.toString('utf8');
  contents.set(absolute, text);
  return text;
}
// Include each nearest config and the full extends chain. TypeScript's public
// parser handles JSONC, multiple extends and package-config resolution; this is
// a build-only dependency, never part of the application runtime.
const inspected = new Set();
const directories = new Set([...input.files, ...input.configs].map((file) => dirname(resolve(root, file))));
for (let directory of directories) {
  while (!inspected.has(directory)) {
    inspected.add(directory);
    const found = ['tsconfig.json', 'jsconfig.json'].map((name) => resolve(directory, name)).filter(existsSync);
    if (found.length) {
      for (const path of found) {
        record(path);
        roots.add(path);
      }
      break;
    }
    if (directory === root) {
      for (let parent = dirname(directory); ; parent = dirname(parent)) {
        if (['tsconfig.json', 'jsconfig.json'].some((name) => existsSync(resolve(parent, name))))
          throw Error('Compiler configuration above project root requires an explicit local config');
        if (parent === dirname(parent)) break;
      }
      break;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}
if (roots.size) {
  const { default: ts } = await import('typescript');
  const errors = [];
  const host = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    getCurrentDirectory: () => root,
    fileExists: (path) => existsSync(path) && statSync(path).isFile(),
    readFile: (path) => (existsSync(path) ? record(path) : undefined),
    readDirectory: () => [],
    onUnRecoverableConfigFileDiagnostic: (error) => errors.push(error),
  };
  const extended = new Map();
  for (const config of roots) {
    const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, host, extended);
    errors.push(...(parsed?.errors ?? []));
  }
  // Input-file discovery is intentionally not run here; the state compiler owns
  // its explicit source inventory. All parse/extends errors still reject.
  const invalid = errors.filter((error) => error.code !== 18002 && error.code !== 18003);
  if (invalid.length)
    throw Error(
      'Compiler configuration: ' +
        invalid.map((error) => ts.flattenDiagnosticMessageText(error.messageText, ' ')).join('; '),
    );
}
const executable =
  '@esbuild/' +
  process.platform +
  '-' +
  process.arch +
  '/' +
  (process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild');
const toolchain = ['esbuild/package.json', 'esbuild', executable, 'typescript/package.json', 'typescript'].map(
  (name) => {
    const path = require.resolve(name),
      data = readFileSync(path);
    return { module: name, sha256: createHash('sha256').update(data).digest('hex') };
  },
);
// Code-unit order: locale collation would change the fingerprint with LANG.
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
console.log(JSON.stringify({ files: [...records.values()].sort(byPath), toolchain }));
