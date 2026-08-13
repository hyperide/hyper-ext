import { describe, expect, it } from 'bun:test';
import {
  deriveSubProjectPrefix,
  toRepoRelativeElementId,
  toRepoRelativePath,
} from '../bridges/monorepo-path-translate';

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
});
