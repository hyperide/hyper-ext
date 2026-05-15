/**
 * @file Shared types for i18n text inspection and editing.
 *
 * Accessed via: SaaS inspector (useElementStyleData) and VS Code extension (StyleReadService)
 * Assumptions: pure data types only — no host I/O, no AST parsing
 */

/** Known i18n libraries that can be auto-detected. 'custom' is set by AST/resource analysis. */
export type I18nLibrary = 'react-i18next' | 'i18next' | 'next-intl' | 'react-intl' | 'lingui' | 'custom';

/** Why a particular expression cannot be treated as an editable i18n binding. */
export type I18nUnsupportedReason =
  | 'dynamic-key'
  | 'non-string-id'
  | 'unknown-wrapper'
  | 'missing-source-location'
  | 'no-i18n-library';

/**
 * Stable inspector model for a JSX child expression that is recognized as an i18n call.
 * All string fields use the active locale unless noted.
 */
export interface I18nTextBinding {
  kind: 'i18n';
  library: I18nLibrary;
  key: string;
  activeLocale: string;
  availableLocales: string[];
  resolvedText: string | null;
  editable: boolean;
  sourceLocation: { filePath: string; line: number; column: number };
}

/**
 * Returned when the expression is not a recognized i18n binding.
 * Consumers should fall back to raw expression editing.
 */
export interface I18nUnsupportedBinding {
  kind: 'unsupported';
  reason: I18nUnsupportedReason;
}

export type I18nBindingResult = I18nTextBinding | I18nUnsupportedBinding;

/**
 * Minimal shape of package.json accepted by pure detection utilities.
 * Only the dependency fields are needed — no file I/O inside detectors.
 */
export interface PackageJsonDeps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
