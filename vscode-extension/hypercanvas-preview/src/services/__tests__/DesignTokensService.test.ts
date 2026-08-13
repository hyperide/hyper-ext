/**
 * @file Unit tests for DesignTokensService — token extraction and classification.
 */

import { describe, expect, it } from 'bun:test';
import { extractDesignTokens } from '../DesignTokensService';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function makeTmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('extractDesignTokens — category classification', () => {
  it('classifies hex-value tokens as colors', () => {
    const dir = makeTmpProject({ 'globals.css': ':root { --brand: #ff0000; }' });
    try {
      const tokens = extractDesignTokens(dir);
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ name: '--brand', value: '#ff0000', category: 'colors' });
    } finally {
      cleanup(dir);
    }
  });

  it('classifies rgb() values as colors', () => {
    const dir = makeTmpProject({ 'theme.css': ':root { --accent: rgb(0, 128, 255); }' });
    try {
      expect(extractDesignTokens(dir)[0]).toMatchObject({ category: 'colors' });
    } finally {
      cleanup(dir);
    }
  });

  it('classifies --color-* by name as colors', () => {
    const dir = makeTmpProject({ 'colors.css': ':root { --color-primary: var(--blue-500); }' });
    try {
      expect(extractDesignTokens(dir)[0]).toMatchObject({ category: 'colors' });
    } finally {
      cleanup(dir);
    }
  });

  it('classifies --font-* tokens as typography', () => {
    const dir = makeTmpProject({ 'typography.css': ':root { --font-size-md: 1rem; }' });
    try {
      expect(extractDesignTokens(dir)[0]).toMatchObject({ category: 'typography' });
    } finally {
      cleanup(dir);
    }
  });

  it('classifies --space-* tokens as spacing', () => {
    const dir = makeTmpProject({ 'spacing.css': ':root { --space-4: 1rem; }' });
    try {
      expect(extractDesignTokens(dir)[0]).toMatchObject({ category: 'spacing' });
    } finally {
      cleanup(dir);
    }
  });

  it('classifies --shadow-* tokens as shadows', () => {
    const dir = makeTmpProject({ 'effects.css': ':root { --shadow-sm: 0 1px 3px rgba(0,0,0,.1); }' });
    try {
      expect(extractDesignTokens(dir)[0]).toMatchObject({ category: 'shadows' });
    } finally {
      cleanup(dir);
    }
  });

  it('classifies unknown patterns as other', () => {
    const dir = makeTmpProject({ 'misc.css': ':root { --z-index-modal: 1000; }' });
    try {
      expect(extractDesignTokens(dir)[0]).toMatchObject({ category: 'other' });
    } finally {
      cleanup(dir);
    }
  });
});

describe('extractDesignTokens — deduplication', () => {
  it('returns each property name only once', () => {
    const dir = makeTmpProject({
      'a.css': ':root { --color-primary: red; }',
      'b.css': ':root { --color-primary: blue; }',
    });
    try {
      const names = extractDesignTokens(dir).map((t) => t.name);
      expect(names.filter((n) => n === '--color-primary')).toHaveLength(1);
    } finally {
      cleanup(dir);
    }
  });

  it('collects tokens from multiple files', () => {
    const dir = makeTmpProject({
      'colors.css': ':root { --color-primary: #111; }',
      'spacing.css': ':root { --space-4: 1rem; }',
    });
    try {
      expect(extractDesignTokens(dir).length).toBeGreaterThanOrEqual(2);
    } finally {
      cleanup(dir);
    }
  });
});

describe('extractDesignTokens — monorepo narrowing', () => {
  it('limits scan to sub-package when activeFilePath is provided', () => {
    const dir = makeTmpProject({
      'root.css': ':root { --root-token: red; }',
      'packages/app/package.json': '{"name":"app"}',
      'packages/app/src/styles.css': ':root { --app-token: blue; }',
    });
    try {
      const activeFile = path.join(dir, 'packages/app/src/Button.tsx');
      const names = extractDesignTokens(dir, activeFile).map((t) => t.name);
      expect(names).toContain('--app-token');
      expect(names).not.toContain('--root-token');
    } finally {
      cleanup(dir);
    }
  });

  it('falls back to projectRoot when activeFilePath has no package.json ancestor', () => {
    const dir = makeTmpProject({ 'global.css': ':root { --global-token: #abc; }' });
    try {
      const names = extractDesignTokens(dir, path.join(dir, 'src/Button.tsx')).map((t) => t.name);
      expect(names).toContain('--global-token');
    } finally {
      cleanup(dir);
    }
  });
});

describe('extractDesignTokens — edge cases', () => {
  it('returns empty array for a project with no CSS files', () => {
    const dir = makeTmpProject({ 'README.md': '# hello' });
    try {
      expect(extractDesignTokens(dir)).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  it('skips node_modules directories', () => {
    const dir = makeTmpProject({
      'node_modules/lib/styles.css': ':root { --nm-token: red; }',
      'src/app.css': ':root { --app-color: blue; }',
    });
    try {
      const names = extractDesignTokens(dir).map((t) => t.name);
      expect(names).not.toContain('--nm-token');
      expect(names).toContain('--app-color');
    } finally {
      cleanup(dir);
    }
  });

  it('does not scan sibling paths that share a name prefix with projectRoot', () => {
    // /tmp/dt-test-XXXX and /tmp/dt-test-XXXXsuffix share a startsWith prefix;
    // the fixed path.relative guard must prevent scanning outside the project root.
    const dir = makeTmpProject({ 'src/app.css': ':root { --in-project: blue; }' });
    // Create a sibling directory whose path starts with dir (e.g. `${dir}extra`)
    const sibling = `${dir}extra`;
    const siblingCss = path.join(sibling, 'styles.css');
    try {
      fs.mkdirSync(sibling, { recursive: true });
      fs.writeFileSync(siblingCss, ':root { --outside-token: red; }', 'utf8');
      // activeFilePath is inside the sibling — resolveSearchRoot must fall back to dir
      const names = extractDesignTokens(dir, path.join(sibling, 'Button.tsx')).map((t) => t.name);
      expect(names).not.toContain('--outside-token');
    } finally {
      cleanup(dir);
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });
});
