import { describe, expect, it } from 'bun:test';
import { stripContainerPrefix, toProjectRelative } from './path-normalization';

describe('stripContainerPrefix', () => {
  it('strips the sandbox mount prefix', () => {
    expect(stripContainerPrefix('/app/src/App.tsx')).toBe('src/App.tsx');
  });

  it('returns already-relative paths unchanged', () => {
    expect(stripContainerPrefix('src/App.tsx')).toBe('src/App.tsx');
  });

  it('leaves unrelated absolute paths alone', () => {
    expect(stripContainerPrefix('/Users/alice/project/src/App.tsx')).toBe('/Users/alice/project/src/App.tsx');
  });
});

describe('toProjectRelative', () => {
  it('strips the sandbox mount prefix without a projectRoot', () => {
    expect(toProjectRelative('/app/src/App.tsx')).toBe('src/App.tsx');
  });

  it('strips a host-absolute projectRoot prefix', () => {
    expect(toProjectRelative('/Users/alice/project/src/App.tsx', '/Users/alice/project')).toBe('src/App.tsx');
  });

  it('tolerates a trailing slash on the projectRoot', () => {
    expect(toProjectRelative('/Users/alice/project/src/App.tsx', '/Users/alice/project/')).toBe('src/App.tsx');
  });

  it('prefers sandbox prefix stripping over projectRoot', () => {
    // Docker paths must normalize even when the host projectRoot is also known.
    expect(toProjectRelative('/app/src/App.tsx', '/Users/alice/project')).toBe('src/App.tsx');
  });

  it('returns already-relative paths unchanged', () => {
    expect(toProjectRelative('src/App.tsx', '/Users/alice/project')).toBe('src/App.tsx');
  });

  it('returns absolute paths unchanged when no match', () => {
    expect(toProjectRelative('/other/path/foo.tsx', '/Users/alice/project')).toBe('/other/path/foo.tsx');
  });

  it('handles empty input', () => {
    expect(toProjectRelative('')).toBe('');
  });

  it('strips Windows host-absolute projectRoot (backslash separators)', () => {
    expect(toProjectRelative('C:\\repo\\src\\App.tsx', 'C:\\repo')).toBe('src/App.tsx');
  });

  it('strips Windows host-absolute projectRoot with trailing backslash', () => {
    expect(toProjectRelative('C:\\repo\\src\\App.tsx', 'C:\\repo\\')).toBe('src/App.tsx');
  });

  it('normalizes backslashes to forward slashes when no match', () => {
    expect(toProjectRelative('C:\\other\\foo.tsx', 'C:\\repo')).toBe('C:/other/foo.tsx');
  });

  it('matches Windows project roots with mismatched drive-letter case', () => {
    // VS Code and source maps sometimes disagree on drive-letter casing.
    expect(toProjectRelative('c:\\repo\\src\\App.tsx', 'C:\\repo')).toBe('src/App.tsx');
    expect(toProjectRelative('C:\\repo\\src\\App.tsx', 'c:\\repo')).toBe('src/App.tsx');
  });

  it('prefers projectRoot when the workspace itself lives under /app/', () => {
    // Devcontainer scenario: workspace root is /app/myproj, fiber path is
    // /app/myproj/src/App.tsx. Stripping sandbox prefix first would yield
    // 'myproj/src/App.tsx' — wrong. projectRoot must win.
    expect(toProjectRelative('/app/myproj/src/App.tsx', '/app/myproj')).toBe('src/App.tsx');
  });

  it('strips the Vite /@fs/ serving prefix from a cross-package fiber path (HYP-443)', () => {
    // A cross-package library component is served by the re-rooted target's Vite
    // dev server via `/@fs/<absolute>`, and that URL leaks into the fiber
    // `_debugSource.fileName`. Strip `/@fs` to recover the real absolute path, then
    // the workspace-root strip yields the repo-relative path the AstService keys on.
    expect(toProjectRelative('/@fs/Users/alice/repo/packages/ui/src/Card.tsx', '/Users/alice/repo')).toBe(
      'packages/ui/src/Card.tsx',
    );
  });

  it('strips /@fs/ even without a projectRoot, yielding the absolute path', () => {
    expect(toProjectRelative('/@fs/Users/alice/repo/packages/ui/src/Card.tsx')).toBe(
      '/Users/alice/repo/packages/ui/src/Card.tsx',
    );
  });

  it('strips a Windows /@fs/ prefix (drive letter, no leading slash after @fs)', () => {
    expect(toProjectRelative('/@fs/C:/repo/packages/ui/src/Card.tsx', 'C:/repo')).toBe('packages/ui/src/Card.tsx');
  });
});
