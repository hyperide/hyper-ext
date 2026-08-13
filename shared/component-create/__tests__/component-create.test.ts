/**
 * Tests for shared/component-create — the single source of truth for the
 * "New component" flow consumed by BOTH the SaaS server route and the VS Code
 * extension host (HYP-1184).
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { createComponentFile } from '../create-component-file';
import { resolveTargetDir } from '../resolve-target-dir';
import { renderComponentTemplate } from '../templates';
import { humanizeComponentName, validateComponentName } from '../validate-name';

describe('validateComponentName', () => {
  it('accepts a plain PascalCase name', () => {
    expect(validateComponentName('Badge')).toBeNull();
    expect(validateComponentName('ProfileCard2')).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(validateComponentName('')).toMatch(/enter a name/i);
    expect(validateComponentName('   ')).toMatch(/enter a name/i);
  });

  it('rejects lowercase starts with a friendly message', () => {
    expect(validateComponentName('badge')).toMatch(/capital letter/i);
  });

  it('rejects spaces, dashes and special characters', () => {
    expect(validateComponentName('My Badge')).toMatch(/letters and numbers/i);
    expect(validateComponentName('my-badge')).toMatch(/capital letter|letters and numbers/i);
    expect(validateComponentName('Badge!')).toMatch(/letters and numbers/i);
  });

  it('rejects names starting with a digit', () => {
    expect(validateComponentName('2Badge')).toMatch(/capital letter/i);
  });

  it('rejects framework-reserved file names', () => {
    for (const reserved of ['Index', 'Page', 'Layout', 'Loading', 'Error', 'Template', 'Default', 'Route']) {
      expect(validateComponentName(reserved)).toMatch(/reserved/i);
    }
  });

  it('rejects overly long names', () => {
    expect(validateComponentName(`A${'b'.repeat(70)}`)).toMatch(/too long/i);
  });
});

describe('humanizeComponentName', () => {
  it('splits PascalCase into words', () => {
    expect(humanizeComponentName('ProfileCard')).toBe('Profile Card');
  });

  it('strips a trailing Page suffix', () => {
    expect(humanizeComponentName('DashboardPage')).toBe('Dashboard');
  });
});

describe('renderComponentTemplate', () => {
  it('atom: named export, tailwind classes, no imports needed', () => {
    const code = renderComponentTemplate({ kind: 'atom', name: 'Badge' });
    expect(code).toContain('export function Badge()');
    expect(code).toContain('className="');
    expect(code).not.toContain('import');
    expect(code).not.toContain('export default');
  });

  it('composite: named export with a section shell', () => {
    const code = renderComponentTemplate({ kind: 'composite', name: 'ProfileCard' });
    expect(code).toContain('export function ProfileCard()');
    expect(code).toContain('Profile Card');
    expect(code).not.toContain('export default');
  });

  it('page: default export with a main landmark', () => {
    const code = renderComponentTemplate({ kind: 'page', name: 'DashboardPage' });
    expect(code).toContain('export default function DashboardPage()');
    expect(code).toContain('<main');
    expect(code).toContain('Dashboard');
  });

  it('produces valid-ish tsx for multi-word names', () => {
    const code = renderComponentTemplate({ kind: 'atom', name: 'FancyNewBadge' });
    expect(code).toContain('export function FancyNewBadge()');
  });
});

describe('resolveTargetDir', () => {
  it('picks the most populous existing group dir for the kind', () => {
    const dir = resolveTargetDir({
      kind: 'atom',
      groupDirs: [
        { dirPath: 'src/components/ui', count: 12 },
        { dirPath: 'src/components', count: 3 },
      ],
      hasSrcDir: true,
    });
    expect(dir).toBe('src/components/ui');
  });

  it('falls back to conventional dirs when no groups exist', () => {
    expect(resolveTargetDir({ kind: 'atom', groupDirs: [], hasSrcDir: true })).toBe('src/components');
    expect(resolveTargetDir({ kind: 'composite', groupDirs: [], hasSrcDir: false })).toBe('components');
    expect(resolveTargetDir({ kind: 'page', groupDirs: [], hasSrcDir: true })).toBe('src/pages');
    expect(resolveTargetDir({ kind: 'page', groupDirs: [], hasSrcDir: false })).toBe('pages');
  });
});

describe('createComponentFile', () => {
  const roots: string[] = [];
  async function makeRoot(withSrc = true) {
    const root = await mkdtemp(path.join(tmpdir(), 'hyp1184-'));
    roots.push(root);
    if (withSrc) {
      await mkdir(path.join(root, 'src'), { recursive: true });
    }
    return root;
  }

  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  it('writes the template to <root>/<dir>/<Name>.tsx and returns the relative path', async () => {
    const root = await makeRoot();
    const result = await createComponentFile({ projectRoot: root, kind: 'atom', name: 'Badge' });
    expect(result.relativePath).toBe('src/components/Badge.tsx');
    const written = await readFile(path.join(root, 'src/components/Badge.tsx'), 'utf8');
    expect(written).toContain('export function Badge()');
  });

  it('creates missing directories recursively', async () => {
    const root = await makeRoot(false);
    const result = await createComponentFile({ projectRoot: root, kind: 'page', name: 'DashboardPage' });
    expect(result.relativePath).toBe('pages/DashboardPage.tsx');
    expect(await readdir(path.join(root, 'pages'))).toEqual(['DashboardPage.tsx']);
  });

  it('honours an explicit dirPath', async () => {
    const root = await makeRoot();
    const result = await createComponentFile({
      projectRoot: root,
      kind: 'atom',
      name: 'Pill',
      dirPath: 'src/components/ui',
    });
    expect(result.relativePath).toBe('src/components/ui/Pill.tsx');
  });

  it('refuses to overwrite an existing file', async () => {
    const root = await makeRoot();
    await createComponentFile({ projectRoot: root, kind: 'atom', name: 'Badge' });
    await expect(createComponentFile({ projectRoot: root, kind: 'atom', name: 'Badge' })).rejects.toThrow(
      /already exists/i,
    );
  });

  it('refuses an invalid component name', async () => {
    const root = await makeRoot();
    await expect(createComponentFile({ projectRoot: root, kind: 'atom', name: 'badge' })).rejects.toThrow(
      /capital letter/i,
    );
  });

  it('refuses dirPath escaping the project root', async () => {
    const root = await makeRoot();
    await expect(
      createComponentFile({ projectRoot: root, kind: 'atom', name: 'Badge', dirPath: '../outside' }),
    ).rejects.toThrow(/outside|traversal|denied/i);
    await expect(
      createComponentFile({ projectRoot: root, kind: 'atom', name: 'Badge', dirPath: '/etc' }),
    ).rejects.toThrow(/outside|traversal|denied/i);
  });

  it('refuses an unknown kind with a picker message', async () => {
    const root = await makeRoot();
    await expect(createComponentFile({ projectRoot: root, kind: 'widget' as never, name: 'Badge' })).rejects.toThrow(
      /building block, a section, or a page/i,
    );
  });

  it('writes into a containmentRoot sibling and rebases the relative path', async () => {
    // Simulates the extension opened at a monorepo leaf: the write target is a
    // sibling sub-project, authorized via the scanned monorepo ancestor root.
    const monoRoot = await mkdtemp(path.join(tmpdir(), 'hyp1184-mono-'));
    roots.push(monoRoot);
    const leaf = path.join(monoRoot, 'leaf-pkg');
    await mkdir(leaf, { recursive: true });
    const result = await createComponentFile({
      projectRoot: leaf,
      containmentRoots: [monoRoot],
      kind: 'atom',
      name: 'Sibling',
      dirPath: '../sibling-pkg/src/components',
    });
    expect(result.relativePath).toBe('../sibling-pkg/src/components/Sibling.tsx');
    const written = await readFile(path.join(monoRoot, 'sibling-pkg/src/components/Sibling.tsx'), 'utf8');
    expect(written).toContain('export function Sibling()');
  });

  it('detects an existing file case-insensitively is out of scope but same-name collision via dir scan works', async () => {
    const root = await makeRoot();
    const dir = path.join(root, 'src/components');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'Badge.tsx'), '// hand-written');
    await expect(createComponentFile({ projectRoot: root, kind: 'atom', name: 'Badge' })).rejects.toThrow(
      /already exists/i,
    );
  });
});
