import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Import-boundary guard (HYP-1002): the readability aid is a read-only DISPLAY aid. It must
 * never reach the style-write path — no `StyleWritePlanner`, no `AstService`, no
 * `ast:updateStyles`. This is enforced structurally so the next refactor can't quietly let the
 * aid start mutating source. We assert on the source text of the aid's own modules (the decision,
 * the DOM collection, and each platform's thin wiring) — none may reference a write-path symbol.
 */
const REPO_ROOT = join(import.meta.dir, '..', '..');

const AID_MODULES = [
  'shared/utils/readable-surface.ts',
  'shared/utils/readability-samples.ts',
  // SaaS wiring
  'client/components/iframe-canvas-hooks/useReadableSurface.ts',
  'client/components/ReadableSurfaceBadge.tsx',
  // VS Code extension wiring
  'vscode-extension/hypercanvas-preview/src/services/scripts/iframe-readability.ts',
  'vscode-extension/hypercanvas-preview/src/webview-preview-panel/useReadableSurface.ts',
  'vscode-extension/hypercanvas-preview/src/webview-preview-panel/ReadableSurfaceBadge.tsx',
];

const FORBIDDEN = ['StyleWritePlanner', 'AstService', 'ast:updateStyles', 'updateStyles', 'StyleAdapter'];

describe('readability-aid import boundary', () => {
  for (const rel of AID_MODULES) {
    test(`${rel} does not reference the style-write path`, () => {
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
      for (const symbol of FORBIDDEN) {
        expect(src.includes(symbol)).toBe(false);
      }
    });
  }
});
