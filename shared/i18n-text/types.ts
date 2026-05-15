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
 * AST-only detection result: binding is recognized and key extracted,
 * but locale/resolvedText are not yet populated (Task 7 adds those).
 */
export interface I18nBindingDetected {
  kind: 'i18n';
  library: I18nLibrary;
  /** Static translation key extracted from the call/element. */
  key: string;
  /** Where the binding expression/element starts in the source file. */
  sourceLocation: { line: number; column: number };
}

/** Return type of detectI18nBinding — pure AST pass, no resource I/O. */
export type I18nBindingDetectionResult = I18nBindingDetected | I18nUnsupportedBinding;

/** Parameters accepted by detectI18nBinding. */
export interface DetectI18nBindingParams {
  /** Full source text of the file containing the JSX. */
  source: string;
  /** File path used for diagnostics (no I/O performed). */
  filePath: string;
  /**
   * Start position of the JSX child node to inspect.
   * For {expr} children: start of the expression inside the braces.
   * For <Component /> children: start of the opening '<'.
   * Uses Babel convention: line 1-based, column 0-based.
   */
  location: { line: number; column: number };
  /** Library hint from package.json scan, or null when unknown. */
  library: I18nLibrary | null;
}

/**
 * Minimal shape of package.json accepted by pure detection utilities.
 * Only the dependency fields are needed — no file I/O inside detectors.
 */
export interface PackageJsonDeps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Why a locale resource could not be resolved. */
export type I18nUnresolvedReason = 'missing-key' | 'missing-locale-file' | 'parse-error' | 'unsupported-format';

/** Result of resolveI18nResource. resolvedText is null when the key or locale file is missing. */
export interface ResolveI18nResourceResult {
  availableLocales: string[];
  activeLocale: string;
  resolvedText: string | null;
  unresolvedReason?: I18nUnresolvedReason;
}
