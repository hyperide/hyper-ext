/**
 * @file HYP-876 — render-error classification. A provider-context crash (or any
 *   crash of a component whose prop schema resolved EMPTY) must classify as
 *   'runtime', never as a "requires props" problem: no props action can fix it.
 */
import { describe, expect, it } from 'bun:test';
import { classifyRenderError, isProviderContextError } from '../classify-render-error';

describe('isProviderContextError', () => {
  it.each([
    'useWorkspace must be used inside <WorkspaceProvider>',
    'useAuth must be used inside <AuthProvider>',
    'useFeatureFlags must be used inside FeatureFlagsProvider',
    'useTheme must be used within a ThemeProvider',
    'could not find react-redux context value; please ensure the component is wrapped in a <Provider>',
    'No QueryClient set, use QueryClientProvider to set one',
  ])('matches %p', (msg) => {
    expect(isProviderContextError(msg)).toBe(true);
  });

  it.each([
    "Cannot read properties of undefined (reading 'name')",
    'useId must be used during render',
    'tweet is not defined',
    '',
    // Mentions "Provider" but is a plain props-shaped crash — must stay 'props'
    // (a false positive here would hide the fixable props card, HYP-876 review).
    "Cannot read properties of undefined (reading 'themeProvider')",
    'props.authProvider is not a function',
  ])('does not match %p', (msg) => {
    expect(isProviderContextError(msg)).toBe(false);
  });

  it('handles null/undefined', () => {
    expect(isProviderContextError(null)).toBe(false);
    expect(isProviderContextError(undefined)).toBe(false);
  });
});

describe('classifyRenderError', () => {
  const providerError = 'useWorkspace must be used inside <WorkspaceProvider>';

  it('provider-context error is runtime regardless of schema state', () => {
    for (const propsSchema of [undefined, null, [], [{ name: 'title', type: 'string', required: true }]]) {
      expect(classifyRenderError({ error: providerError, propsSchema, extractedProps: [] })).toBe('runtime');
    }
  });

  it('provider-context error stays runtime even when the message also has prop-shaped hints', () => {
    const error = "useAuth must be used inside <AuthProvider> (reading 'user')";
    expect(classifyRenderError({ error, propsSchema: undefined, extractedProps: ['user'] })).toBe('runtime');
  });

  it('empty resolved schema + no extracted props is runtime (component takes no props)', () => {
    expect(classifyRenderError({ error: 'boom from a useEffect', propsSchema: [], extractedProps: [] })).toBe(
      'runtime',
    );
  });

  it('empty resolved schema but prop hints in the error stays props', () => {
    expect(
      classifyRenderError({
        error: "Cannot read properties of undefined (reading 'author')",
        propsSchema: [],
        extractedProps: ['author'],
      }),
    ).toBe('props');
  });

  it('schema still loading (undefined) defaults to props', () => {
    expect(classifyRenderError({ error: 'boom', propsSchema: undefined, extractedProps: [] })).toBe('props');
  });

  it('non-empty schema is props', () => {
    expect(
      classifyRenderError({
        error: 'boom',
        propsSchema: [{ name: 'title', type: 'string', required: true }],
        extractedProps: [],
      }),
    ).toBe('props');
  });
});
