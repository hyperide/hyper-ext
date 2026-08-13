/**
 * @file Unit tests for isProviderContextError — detects React
 * context-provider errors thrown by a previewed component that renders
 * OUTSIDE its provider tree.
 *
 * Accessed via: extension.ts activate() → previewPanel.onComponentError
 *               (HYP-487 auto-isolation when a context hook throws).
 * Assumptions: the iframe ErrorBoundary forwards the raw `error.message`
 *              string from the caught render exception.
 * Past bugs: HYP-487 — no-router Vite apps (conloca-app) patch the entry
 *            file to mount the previewed component via its own createRoot,
 *            bypassing <App> where AuthProvider / FeatureFlagsProvider live.
 *            useAuth / useFeatureFlags then throw and the preview is blank.
 *            The two real messages this must match:
 *              "useAuth must be used inside <AuthProvider>"   (angle brackets)
 *              "useFeatureFlags must be used inside FeatureFlagsProvider"
 *            (no angle brackets — both phrasings exist in the same app).
 */
import { describe, expect, it } from 'bun:test';
import { isProviderContextError } from '../extension-utils';

describe('isProviderContextError', () => {
  it('matches the conloca-app useAuth message (angle brackets)', () => {
    expect(isProviderContextError('useAuth must be used inside <AuthProvider>')).toBe(true);
  });

  it('matches the conloca-app useFeatureFlags message (no angle brackets)', () => {
    expect(isProviderContextError('useFeatureFlags must be used inside FeatureFlagsProvider')).toBe(true);
  });

  it('matches the "within" phrasing', () => {
    expect(isProviderContextError('useTheme must be used within a ThemeProvider')).toBe(true);
  });

  it('matches the "within an" article phrasing', () => {
    expect(isProviderContextError('useAuth must be used within an AuthProvider')).toBe(true);
  });

  it('matches "must be used within <RouterProvider>" with angle brackets', () => {
    expect(isProviderContextError('useRouter must be used within <RouterProvider>')).toBe(true);
  });

  it('does NOT match a generic runtime error', () => {
    expect(isProviderContextError('Cannot read properties of undefined (reading "map")')).toBe(false);
  });

  it('does NOT match a message that mentions Provider without the hook-context phrasing', () => {
    expect(isProviderContextError('Failed to load AuthProvider chunk')).toBe(false);
  });

  it('does NOT match a "must be used" message that is not about a Provider', () => {
    expect(isProviderContextError('useId must be used during render')).toBe(false);
  });

  it('returns false for null / undefined / empty', () => {
    expect(isProviderContextError(null)).toBe(false);
    expect(isProviderContextError(undefined)).toBe(false);
    expect(isProviderContextError('')).toBe(false);
  });
});
