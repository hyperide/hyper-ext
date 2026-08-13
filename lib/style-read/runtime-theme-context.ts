/**
 * @file RuntimeThemeContext normalization shared by SaaS and VS Code style managers
 *
 * Accessed via: style read/write request builders before invoking shared managers
 * Assumptions: callers resolve OS/browser system color scheme at the platform boundary
 *   so shared tests and manager routing never depend on ambient machine theme.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import type {
  CssClassRuntimeThemeContextInput,
  IdeThemePreference,
  ResolvedColorScheme,
  RuntimeThemeContext,
  RuntimeThemeContextInput,
  RuntimeThemeSource,
  ThemeCondition,
  ThemeContextResolver,
  ThemeStateRuntimeThemeContextInput,
} from './types';

export class DefaultThemeContextResolver implements ThemeContextResolver {
  resolve(input: RuntimeThemeContextInput): RuntimeThemeContext {
    return createRuntimeThemeContext(input);
  }
}

/**
 * Build the canonical {@link RuntimeThemeContext} the read/write managers route on: resolve
 * the effective light/dark scheme from the IDE preference (or the supplied system scheme when
 * preference is `system`) and derive a default `color-scheme` theme condition unless the caller
 * opts out. This is the one place light/dark resolution happens so manager routing never reads
 * ambient machine theme (see file header). USER-IMPACT: drives which theme the inspector reads
 * and edits styles under (e.g. a value shown for `.dark`).
 */
export function createRuntimeThemeContext(input: RuntimeThemeContextInput): RuntimeThemeContext {
  const resolvedColorScheme = resolveColorScheme(input.ideThemePreference, input.systemColorScheme);
  const selectedTheme =
    input.selectedTheme ??
    buildDefaultSelectedTheme(resolvedColorScheme, input.source, input.includeColorSchemeCondition);

  return {
    ideThemePreference: input.ideThemePreference,
    resolvedColorScheme,
    source: input.source,
    selectedTheme,
  };
}

/**
 * Adapter for callers that already hold a resolved theme-state triple
 * (`theme` preference + `resolvedTheme` + optional explicit `selectedTheme`). Normalizes the
 * `'system'` case to feed `resolvedTheme` as the system scheme, then delegates to
 * {@link createRuntimeThemeContext}.
 */
export function createRuntimeThemeContextFromThemeState(
  input: ThemeStateRuntimeThemeContextInput,
): RuntimeThemeContext {
  if (input.theme === 'system') {
    return createRuntimeThemeContext({
      ideThemePreference: 'system',
      source: input.source,
      systemColorScheme: input.resolvedTheme,
      selectedTheme: input.selectedTheme,
      includeColorSchemeCondition: input.includeColorSchemeCondition,
    });
  }

  return createRuntimeThemeContext({
    ideThemePreference: input.theme,
    source: input.source,
    systemColorScheme: input.resolvedTheme,
    selectedTheme: input.selectedTheme,
    includeColorSchemeCondition: input.includeColorSchemeCondition,
  });
}

/**
 * Build a theme context by INFERRING the active scheme from the live DOM class list — the
 * `dark`/`light` and VS Code `vscode-dark`/`vscode-light`/`vscode-high-contrast` marker
 * classes (see {@link themePreferenceFromCssClasses}), defaulting to `system` when none are
 * present. Used when the preview frame's theme is only observable as classes on the root.
 */
export function createRuntimeThemeContextFromCssClasses(input: CssClassRuntimeThemeContextInput): RuntimeThemeContext {
  const ideThemePreference = themePreferenceFromCssClasses(input.classNames);
  if (ideThemePreference === 'system') {
    return createRuntimeThemeContext({
      ideThemePreference,
      source: input.source,
      systemColorScheme: input.systemColorScheme,
      selectedTheme: input.selectedTheme,
      includeColorSchemeCondition: input.includeColorSchemeCondition,
    });
  }

  return createRuntimeThemeContext({
    ideThemePreference,
    source: input.source,
    systemColorScheme: input.systemColorScheme,
    selectedTheme: input.selectedTheme,
    includeColorSchemeCondition: input.includeColorSchemeCondition,
  });
}

function resolveColorScheme(
  ideThemePreference: IdeThemePreference,
  systemColorScheme: ResolvedColorScheme | undefined,
): ResolvedColorScheme {
  if (ideThemePreference === 'light' || ideThemePreference === 'dark') {
    return ideThemePreference;
  }

  if (!systemColorScheme) {
    throw new Error('systemColorScheme is required when ideThemePreference is system');
  }

  return systemColorScheme;
}

function themePreferenceFromCssClasses(classNames: string[]): IdeThemePreference {
  const classSet = new Set(classNames);
  if (classSet.has('dark') || classSet.has('vscode-dark') || classSet.has('vscode-high-contrast')) {
    return 'dark';
  }

  if (classSet.has('light') || classSet.has('vscode-light')) {
    return 'light';
  }

  return 'system';
}

function buildDefaultSelectedTheme(
  resolvedColorScheme: ResolvedColorScheme,
  source: RuntimeThemeSource,
  includeColorSchemeCondition: boolean | undefined,
): ThemeCondition[] | undefined {
  if (includeColorSchemeCondition === false) {
    return undefined;
  }

  if (source === 'browser-system') {
    return [
      {
        axis: 'color-scheme',
        value: resolvedColorScheme,
        source: 'prefers-color-scheme',
        query: `(prefers-color-scheme: ${resolvedColorScheme})`,
      },
    ];
  }

  return [
    {
      axis: 'color-scheme',
      value: resolvedColorScheme,
      source: 'custom',
    },
  ];
}
