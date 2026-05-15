/**
 * @file RuntimeThemeContext resolver tests — verifies shared theme context normalization
 *
 * Accessed via: bun test lib/style-read/runtime-theme-context.test.ts
 * Assumptions: platform code supplies deterministic system color scheme in tests
 *   so read/write routing never depends on the developer machine's OS theme.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it } from 'bun:test';
import {
  createRuntimeThemeContext,
  createRuntimeThemeContextFromCssClasses,
  createRuntimeThemeContextFromThemeState,
  DefaultThemeContextResolver,
} from './runtime-theme-context';

describe('RuntimeThemeContext resolver', () => {
  it('resolves explicit light preference without using system color scheme', () => {
    const context = createRuntimeThemeContext({
      ideThemePreference: 'light',
      source: 'hyperide',
      systemColorScheme: 'dark',
    });

    expect(context).toEqual({
      ideThemePreference: 'light',
      resolvedColorScheme: 'light',
      source: 'hyperide',
      selectedTheme: [
        {
          axis: 'color-scheme',
          value: 'light',
          source: 'custom',
        },
      ],
    });
  });

  it('preserves system preference while resolving it to a concrete color scheme', () => {
    const context = createRuntimeThemeContext({
      ideThemePreference: 'system',
      source: 'browser-system',
      systemColorScheme: 'dark',
    });

    expect(context.ideThemePreference).toBe('system');
    expect(context.resolvedColorScheme).toBe('dark');
    expect(context.selectedTheme).toEqual([
      {
        axis: 'color-scheme',
        value: 'dark',
        source: 'prefers-color-scheme',
        query: '(prefers-color-scheme: dark)',
      },
    ]);
  });

  it('uses provided selected theme conditions instead of synthesizing color scheme', () => {
    const context = createRuntimeThemeContext({
      ideThemePreference: 'dark',
      source: 'app-runtime',
      selectedTheme: [{ axis: 'brand', value: 'enterprise', source: 'theme-provider', provider: 'acme' }],
    });

    expect(context.selectedTheme).toEqual([
      {
        axis: 'brand',
        value: 'enterprise',
        source: 'theme-provider',
        provider: 'acme',
      },
    ]);
  });

  it('builds VS Code context from body class facts', () => {
    const context = createRuntimeThemeContextFromCssClasses({
      classNames: ['vscode-dark'],
      source: 'vscode',
      systemColorScheme: 'light',
    });

    expect(context.ideThemePreference).toBe('dark');
    expect(context.resolvedColorScheme).toBe('dark');
    expect(context.source).toBe('vscode');
  });

  it('builds HyperIDE context from ThemeProvider state', () => {
    const context = createRuntimeThemeContextFromThemeState({
      theme: 'system',
      resolvedTheme: 'light',
      source: 'hyperide',
    });

    expect(context).toMatchObject({
      ideThemePreference: 'system',
      resolvedColorScheme: 'light',
      source: 'hyperide',
    });
  });

  it('exposes a ThemeContextResolver class for manager injection', () => {
    const resolver = new DefaultThemeContextResolver();

    expect(
      resolver.resolve({
        ideThemePreference: 'dark',
        source: 'test-fixture',
      }),
    ).toMatchObject({
      ideThemePreference: 'dark',
      resolvedColorScheme: 'dark',
      source: 'test-fixture',
    });
  });
});
