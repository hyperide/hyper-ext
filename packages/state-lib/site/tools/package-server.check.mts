import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync('deploy.sh', 'utf8');
function checkOrder(script: string) {
  const commands = script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const build = commands.findIndex((line) => /^vercel build \$target\s/.test(line));
  const pack = commands.findIndex((line) => /^bunx tsx tools\/package-server\.mts$/.test(line));
  const check = commands.findIndex((line) => /^bunx tsx tools\/package-server\.test\.mts$/.test(line));
  const publish = commands.findIndex((line) => /^vercel deploy --prebuilt\s/.test(line));
  assert(
    build >= 0 && pack > build && check > pack && publish > check,
    'Checked deployment must package and validate the self-contained function before publication',
  );
}
checkOrder(source);
assert.throws(() =>
  checkOrder(source.replace('bunx tsx tools/package-server.mts', '# bunx tsx tools/package-server.mts')),
);
assert.throws(() =>
  checkOrder(source.replace('bunx tsx tools/package-server.mts', 'echo "bunx tsx tools/package-server.mts"')),
);
// check-all.mts discovers every *.check.mts automatically, including this guard.
assert(readFileSync('tools/check-all.mts', 'utf8').includes("endsWith('.check.mts')"));
console.log('PASS: checked command ordering rejects commented-out packaging');
