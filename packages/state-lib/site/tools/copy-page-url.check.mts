import assert from 'node:assert/strict';
import { markdownRequestUrl } from '../src/lib/page-markdown';
const origin = 'https://docs.example:8443';
for (const [route, expected] of [
  ['/', 'https://docs.example:8443/index.md'],
  ['/concepts', 'https://docs.example:8443/concepts.md'],
  ['/concepts/practical', 'https://docs.example:8443/concepts/practical.md'],
  ['/repl/board-commands', 'https://docs.example:8443/repl/board-commands.md'],
  ['/repl/read-write/', 'https://docs.example:8443/repl/read-write.md'],
]) {
  assert.equal(markdownRequestUrl(route, origin)?.href, expected);
}
for (const route of [
  '//attacker.example/collect',
  '///attacker.example/collect',
  '/\\attacker.example/collect',
  '/%2f%2fattacker.example/collect',
  '/%2Fattacker.example/collect',
  '/%5cattacker.example/collect',
  '/spec/../secret',
  '/spec/%2e%2e/secret',
  'https://attacker.example/collect',
  '/spec?url=https://attacker.example',
  '/spec#fragment',
  '/spec%',
  '/\n/spec',
]) {
  assert.equal(markdownRequestUrl(route, origin), null, `Unsafe pathname must not create a request: ${route}`);
}
for (const origin of ['file://', 'null', 'https://docs.example/path', 'https://docs.example#fragment']) {
  assert.equal(markdownRequestUrl('/spec', origin), null);
}
console.log('PASS: Copy page keeps canonical Markdown requests on the current origin and rejects ambiguous pathnames');
