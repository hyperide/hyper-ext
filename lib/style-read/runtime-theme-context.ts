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
