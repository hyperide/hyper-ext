/**
 * @file Tests for the shared filesystem scan-exclude sets and isExcludedScanPath.
 *
 * Accessed via: bun test shared/fs/__tests__/scan-excludes.test.ts
 * Assumptions: sets are layered (CORE ⊂ DIRS ⊂ SCANNER) and contain bare dir names only.
 */

import { describe, expect, it } from 'bun:test';
import { isExcludedScanPath, SCAN_EXCLUDE_CORE, SCAN_EXCLUDE_DIRS, SCAN_EXCLUDE_SCANNER } from '../scan-excludes';

describe('scan-exclude set layering', () => {
  it('CORE is the hard minimum', () => {
    for (const d of ['node_modules', '.git', 'dist', '.next']) {
      expect(SCAN_EXCLUDE_CORE.has(d)).toBe(true);
    }
  });

  it('DIRS is a superset of CORE', () => {
    for (const d of SCAN_EXCLUDE_CORE) expect(SCAN_EXCLUDE_DIRS.has(d)).toBe(true);
  });

  it('SCANNER is a superset of DIRS', () => {
    for (const d of SCAN_EXCLUDE_DIRS) expect(SCAN_EXCLUDE_SCANNER.has(d)).toBe(true);
  });

  it('public/assets are SCANNER-only (must NOT leak into DIRS — content grep needs public/locales)', () => {
    expect(SCAN_EXCLUDE_SCANNER.has('public')).toBe(true);
    expect(SCAN_EXCLUDE_SCANNER.has('assets')).toBe(true);
    expect(SCAN_EXCLUDE_DIRS.has('public')).toBe(false);
    expect(SCAN_EXCLUDE_DIRS.has('assets')).toBe(false);
  });

  it('DIRS includes the consolidated tooling dirs', () => {
    for (const d of ['build', 'out', '.cache', '.turbo', 'coverage', '__pycache__', '.husky', '.vite']) {
      expect(SCAN_EXCLUDE_DIRS.has(d)).toBe(true);
    }
  });
});

describe('isExcludedScanPath', () => {
  it('matches when any POSIX segment is excluded', () => {
    expect(isExcludedScanPath('/project/node_modules/lib/en.json')).toBe(true);
    expect(isExcludedScanPath('foo/.git/config')).toBe(true);
    expect(isExcludedScanPath('a/dist/b.js')).toBe(true);
  });

  it('matches Windows-style separators', () => {
    expect(isExcludedScanPath('C:\\project\\node_modules\\pkg\\x.ts')).toBe(true);
  });

  it('does not match when no segment is excluded', () => {
    expect(isExcludedScanPath('/project/config/strings/en.json')).toBe(false);
    expect(isExcludedScanPath('src/locales/en.json')).toBe(false);
  });

  it('does not partial-match a dir name embedded in a longer segment', () => {
    // "distribution" contains "dist" as a substring but is not the "dist" dir.
    expect(isExcludedScanPath('/project/distribution/en.json')).toBe(false);
  });

  it('honors a custom exclude set (SCANNER excludes public, DIRS does not)', () => {
    expect(isExcludedScanPath('/p/public/locales/en.json', SCAN_EXCLUDE_SCANNER)).toBe(true);
    expect(isExcludedScanPath('/p/public/locales/en.json', SCAN_EXCLUDE_DIRS)).toBe(false);
  });
});
