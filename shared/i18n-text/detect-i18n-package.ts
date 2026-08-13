/**
 * @file Pure i18n package detection from package.json dependency fields.
 *
 * Accepts a pre-parsed PackageJsonDeps object (no FileIO).
 * Returns the matched I18nLibrary string (excluding 'custom') or null.
 * 'custom' requires AST + resource analysis and is not handled here.
 */
import type { I18nLibrary, PackageJsonDeps } from './types';

type DetectableLibrary = Exclude<I18nLibrary, 'custom'>;

const PACKAGE_TO_LIBRARY: Array<[string, DetectableLibrary]> = [
  ['react-i18next', 'react-i18next'],
  ['i18next', 'i18next'],
  ['next-intl', 'next-intl'],
  ['react-intl', 'react-intl'],
  ['@lingui/react', 'lingui'],
  ['@lingui/core', 'lingui'],
];

function hasDep(deps: Record<string, string> | undefined, pkg: string): boolean {
  return deps != null && pkg in deps;
}

export function detectI18nPackage(pkg: PackageJsonDeps): DetectableLibrary | null {
  const { dependencies, devDependencies } = pkg;
  for (const [packageName, library] of PACKAGE_TO_LIBRARY) {
    if (hasDep(dependencies, packageName) || hasDep(devDependencies, packageName)) {
      return library;
    }
  }
  return null;
}
