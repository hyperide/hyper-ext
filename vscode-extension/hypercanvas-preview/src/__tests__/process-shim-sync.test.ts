/**
 * @file Guards behavioral sync between the two twin copies of the process-shim.
 *
 * Two copies serve the shim to different runtimes:
 *   - shared/scripts/process-shim.js  → SaaS proxy (/__hypercanvas/process-shim.js)
 *   - PreviewProxy.ts processShimScriptContent → VS Code extension (injected into <head>)
 *
 * If they drift, SaaS and local previews would behave differently when a user app reads
 * `process.env.NODE_ENV` at module-init time (the whole reason the shim exists).
 *
 * This test does NOT require string equality (comments and `const` vs `var` are fine)
 * but asserts both carry the same behavioral contract tokens.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';

const sharedShim = readFileSync(path.resolve(import.meta.dir, '../../../../shared/scripts/process-shim.js'), 'utf8');

// Extract the inline twin from processShimScriptContent in PreviewProxy.ts.
// The constant is module-private (not exported), so we read the source file and
// slice out the template literal that holds the shim body.
const proxySource = readFileSync(path.resolve(import.meta.dir, '../services/PreviewProxy.ts'), 'utf8');
const match = proxySource.match(/const processShimScriptContent\s*=\s*`([\s\S]*?)`\s*;/);
if (!match) throw new Error('processShimScriptContent template literal not found in PreviewProxy.ts');
const extensionShim = match[1];

/** Tokens that define the behavioural contract of the shim. */
const CONTRACT_TOKENS = ['NODE_ENV', "'development'", 'globalThis', 'process.env'];

describe('process-shim twin sync', () => {
  for (const token of CONTRACT_TOKENS) {
    it(`shared/scripts/process-shim.js contains "${token}"`, () => {
      expect(sharedShim).toContain(token);
    });
    it(`PreviewProxy.ts processShimScriptContent contains "${token}"`, () => {
      expect(extensionShim).toContain(token);
    });
  }

  it('both twins assign to g.process (the process alias target)', () => {
    expect(sharedShim).toContain('g.process');
    expect(extensionShim).toContain('g.process');
  });
});
