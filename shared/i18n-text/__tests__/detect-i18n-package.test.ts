/**
 * @file Tests for i18n package detection from parsed package.json data.
 *
 * detectI18nPackage accepts a pre-parsed PackageJsonDeps object (no FileIO).
 * Returns the matched I18nLibrary string or null when no known library is found.
 * 'custom' is NOT returned here — that requires AST + resource analysis (Task 5/6).
 */

import { describe, expect, it } from 'bun:test';
import { detectI18nPackage } from '../detect-i18n-package';
import type { PackageJsonDeps } from '../types';

// ---------------------------------------------------------------------------
// react-i18next
// ---------------------------------------------------------------------------

describe('react-i18next', () => {
  it('detects react-i18next in dependencies', () => {
    const pkg: PackageJsonDeps = { dependencies: { 'react-i18next': '^13.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('react-i18next');
  });

  it('detects react-i18next in devDependencies', () => {
    const pkg: PackageJsonDeps = { devDependencies: { 'react-i18next': '^13.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('react-i18next');
  });
});

// ---------------------------------------------------------------------------
// i18next (standalone, without react binding)
// ---------------------------------------------------------------------------

describe('i18next', () => {
  it('detects i18next in dependencies', () => {
    const pkg: PackageJsonDeps = { dependencies: { i18next: '^23.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('i18next');
  });

  it('detects i18next in devDependencies', () => {
    const pkg: PackageJsonDeps = { devDependencies: { i18next: '^23.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('i18next');
  });

  it('prefers react-i18next over i18next when both present', () => {
    const pkg: PackageJsonDeps = {
      dependencies: { i18next: '^23.0.0', 'react-i18next': '^13.0.0' },
    };
    expect(detectI18nPackage(pkg)).toBe('react-i18next');
  });
});

// ---------------------------------------------------------------------------
// next-intl
// ---------------------------------------------------------------------------

describe('next-intl', () => {
  it('detects next-intl in dependencies', () => {
    const pkg: PackageJsonDeps = { dependencies: { 'next-intl': '^3.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('next-intl');
  });

  it('detects next-intl in devDependencies', () => {
    const pkg: PackageJsonDeps = { devDependencies: { 'next-intl': '^3.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('next-intl');
  });
});

// ---------------------------------------------------------------------------
// react-intl
// ---------------------------------------------------------------------------

describe('react-intl', () => {
  it('detects react-intl in dependencies', () => {
    const pkg: PackageJsonDeps = { dependencies: { 'react-intl': '^6.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('react-intl');
  });

  it('detects react-intl in devDependencies', () => {
    const pkg: PackageJsonDeps = { devDependencies: { 'react-intl': '^6.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('react-intl');
  });
});

// ---------------------------------------------------------------------------
// Lingui (@lingui/react → label 'lingui')
// ---------------------------------------------------------------------------

describe('lingui', () => {
  it('detects @lingui/react in dependencies and returns lingui label', () => {
    const pkg: PackageJsonDeps = { dependencies: { '@lingui/react': '^4.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('lingui');
  });

  it('detects @lingui/react in devDependencies and returns lingui label', () => {
    const pkg: PackageJsonDeps = { devDependencies: { '@lingui/react': '^4.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('lingui');
  });

  it('detects @lingui/core without @lingui/react', () => {
    const pkg: PackageJsonDeps = { dependencies: { '@lingui/core': '^4.0.0' } };
    expect(detectI18nPackage(pkg)).toBe('lingui');
  });
});

// ---------------------------------------------------------------------------
// No known library → null (not 'custom' — custom requires AST analysis)
// ---------------------------------------------------------------------------

describe('no i18n library', () => {
  it('returns null for empty package', () => {
    expect(detectI18nPackage({})).toBeNull();
  });

  it('returns null when only unrelated dependencies exist', () => {
    const pkg: PackageJsonDeps = {
      dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
    };
    expect(detectI18nPackage(pkg)).toBeNull();
  });

  it('returns null when both dep sections are missing', () => {
    const pkg: PackageJsonDeps = {};
    expect(detectI18nPackage(pkg)).toBeNull();
  });
});
