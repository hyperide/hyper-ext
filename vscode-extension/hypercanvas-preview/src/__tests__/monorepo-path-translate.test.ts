import { describe, expect, it } from 'bun:test';
import {
  deriveSubProjectPrefix,
  resolveComponentAbsPath,
  toRepoRelativeElementId,
  toRepoRelativePath,
} from '../bridges/monorepo-path-translate';

describe('resolveComponentAbsPath', () => {
  it('re-roots a sub-project-relative path through the prefix (monorepo)', () => {
    expect(resolveComponentAbsPath('src/app/ui/HostField.tsx', '/repo', 'targets/conloca-app/')).toBe(
      '/repo/targets/conloca-app/src/app/ui/HostField.tsx',
    );
  });

  it('is identity re-root for single-package projects (empty prefix)', () => {
    expect(resolveComponentAbsPath('src/app/ui/HostField.tsx', '/repo', '')).toBe('/repo/src/app/ui/HostField.tsx');
  });

  it('does not double-prepend an already repo-relative path', () => {
    expect(resolveComponentAbsPath('targets/conloca-app/src/app/x.tsx', '/repo', 'targets/conloca-app/')).toBe(
      '/repo/targets/conloca-app/src/app/x.tsx',
    );
  });

  it('passes absolute paths through unchanged', () => {
    expect(resolveComponentAbsPath('/abs/src/x.tsx', '/repo', 'targets/conloca-app/')).toBe('/abs/src/x.tsx');
  });
});

describe('deriveSubProjectPrefix', () => {
  it('derives the prefix from repo-relative minus sub-relative suffix', () => {
    expect(deriveSubProjectPrefix('targets/conloca-app/src/app/page.tsx', 'src/app/page.tsx')).toBe(
      'targets/conloca-app/',
    );
  });

  it('returns empty prefix for single-package projects (paths coincide)', () => {
    expect(deriveSubProjectPrefix('src/App.tsx', 'src/App.tsx')).toBe('');
  });

  it('returns empty prefix when either path is missing', () => {
    expect(deriveSubProjectPrefix(undefined, 'src/App.tsx')).toBe('');
    expect(deriveSubProjectPrefix('src/App.tsx', undefined)).toBe('');
  });

  it('rejects non-segment-aligned partial suffix matches', () => {
    // 'rc/x.tsx' is a char-suffix of 'src/x.tsx' but not a segment-aligned one.
    expect(deriveSubProjectPrefix('src/x.tsx', 'rc/x.tsx')).toBe('');
  });

  it('normalizes Windows backslash paths before deriving the prefix', () => {
    // Node path.relative yields backslashes on Windows — must not disable translation.
    expect(deriveSubProjectPrefix('targets\\conloca-app\\src\\app\\page.tsx', 'src\\app\\page.tsx')).toBe(
      'targets/conloca-app/',
    );
  });
});

describe('toRepoRelativePath', () => {
  const prefix = 'targets/conloca-app/';

  it('prepends the prefix to a sub-relative path', () => {
    expect(toRepoRelativePath('src/app/page.tsx', prefix)).toBe('targets/conloca-app/src/app/page.tsx');
  });

  it('is an identity no-op when prefix is empty', () => {
    expect(toRepoRelativePath('src/app/page.tsx', '')).toBe('src/app/page.tsx');
  });

  it('does not double-prefix an already-repo-relative path', () => {
    expect(toRepoRelativePath('targets/conloca-app/src/app/page.tsx', prefix)).toBe(
      'targets/conloca-app/src/app/page.tsx',
    );
  });

  it('leaves absolute paths untouched', () => {
    expect(toRepoRelativePath('/abs/src/app/page.tsx', prefix)).toBe('/abs/src/app/page.tsx');
    expect(toRepoRelativePath('C:/abs/page.tsx', prefix)).toBe('C:/abs/page.tsx');
  });

  it('normalizes and prepends for Windows backslash sub-relative paths', () => {
    expect(toRepoRelativePath('src\\app\\page.tsx', prefix)).toBe('targets/conloca-app/src/app/page.tsx');
  });
});

describe('toRepoRelativeElementId', () => {
  const prefix = 'targets/conloca-app/';

  it('translates the fileName part and preserves line:column', () => {
    expect(toRepoRelativeElementId('src/app/page.tsx:42:7', prefix)).toBe('targets/conloca-app/src/app/page.tsx:42:7');
  });

  it('is an identity no-op when prefix is empty', () => {
    expect(toRepoRelativeElementId('src/app/page.tsx:42:7', '')).toBe('src/app/page.tsx:42:7');
  });

  it('leaves ids that are not fileName:line:column untouched', () => {
    expect(toRepoRelativeElementId('synthetic-ref-abc', prefix)).toBe('synthetic-ref-abc');
  });

  it('strips the Vite /@fs/ prefix from the fileName even with an empty prefix (HYP-443)', () => {
    // Cross-package library edit: the iframe emits the Vite-served `/@fs/<abs>` URL
    // and the sub-project prefix is empty, so the path must still be normalized to
    // the real absolute file for the AST mutation to land.
    expect(toRepoRelativeElementId('/@fs/Users/alice/repo/packages/ui/src/Card.tsx:42:7', '')).toBe(
      '/Users/alice/repo/packages/ui/src/Card.tsx:42:7',
    );
  });
});

describe('toRepoRelativePath — Vite /@fs/ normalization (HYP-443)', () => {
  it('strips /@fs/ to the real absolute path with an empty prefix', () => {
    expect(toRepoRelativePath('/@fs/Users/alice/repo/packages/ui/src/Card.tsx', '')).toBe(
      '/Users/alice/repo/packages/ui/src/Card.tsx',
    );
  });

  it('strips a slash-dropped @fs/ prefix (webview hop drops the leading slash)', () => {
    expect(toRepoRelativePath('@fs/Users/alice/repo/packages/ui/src/Card.tsx', '')).toBe(
      '/Users/alice/repo/packages/ui/src/Card.tsx',
    );
  });

  it('strips a Windows /@fs/ prefix (drive letter retained)', () => {
    expect(toRepoRelativePath('/@fs/C:/repo/packages/ui/src/Card.tsx', '')).toBe('C:/repo/packages/ui/src/Card.tsx');
  });
});
