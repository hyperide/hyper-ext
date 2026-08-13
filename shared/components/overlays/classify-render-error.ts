/**
 * @file Classify a preview render error: missing-props problem vs a genuine
 *   runtime error (missing context provider, crashed effect, broken import).
 *
 * Accessed via:
 *   - ComponentErrorOverlay (SaaS + VS Code webview) — picks the card variant:
 *     the props form ("requires props") or the honest runtime-error card.
 *   - extract-props-from-error.shouldAutoCreateEmptySampleFromError — never
 *     auto-write a SampleDefault for a provider-context error (a sample cannot
 *     fix it; HYP-876 saw repeated scaffold writes polluting client source).
 *   - VS Code extension host (re-exported through extension-utils.ts) — the
 *     HYP-487 auto-wrapper trigger. Single source: host and webview must agree
 *     on what counts as a provider error.
 *
 * Past bugs: HYP-876 — a component with NO props crashed at runtime because a
 *   hook it called threw for missing its React context provider (e.g. "useX
 *   must be used inside <XProvider>"), yet the overlay still claimed "This
 *   component requires props to render" forever, hiding a live render behind
 *   a card no action on which could ever succeed. A provider-context crash is
 *   a runtime problem, not a props one — no props form can fix it.
 */

import type { SimplePropInfo } from './PropsForm';

/**
 * Returns true when an error message is a React context-provider error —
 * the kind a hook like `useAuth` / `useFeatureFlags` throws when the
 * component renders OUTSIDE its provider tree.
 *
 * HYP-487: no-router Vite apps patch the entry file to mount the previewed
 * component via its own `createRoot`, bypassing `<App>` where the providers
 * live. The context hooks then throw and the preview is blank. Matching this
 * pattern lets the extension auto-generate the `.hyperide/preview.tsx`
 * wrapper (isolated mode) so the component renders inside its providers.
 *
 * Matches the common real-world phrasings, e.g.:
 *   "useAuth must be used inside <AuthProvider>"        (angle brackets)
 *   "useFeatureFlags must be used inside FeatureFlagsProvider"  (bare)
 * and the common "within (a) XProvider" variant. The `\w*Provider` anchor
 * keeps it from firing on generic "must be used" errors that don't name a
 * Provider (e.g. "useId must be used during render").
 *
 * DEFENSIVE BROADENING (HYP-487 follow-up — hardening, not tied to a
 * confirmed repro): the original regex matches ONLY the "must be used
 * (inside|within) …Provider" phrasing. Other libraries throw "missing
 * provider" errors with different wording; a component reaching one of those
 * FIRST would slip the detector and leave a silent blank preview with no
 * guidance. We also recognise:
 *   - react-query: "No QueryClient set, use QueryClientProvider to set one"
 *   - react-redux: "could not find react-redux context value; … wrapped in a <Provider>"
 *   - generic:     "must be wrapped in <ThemeProvider>"
 */
export function isProviderContextError(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    /must be used (?:inside|within)\s+(?:an?\s+)?<?\w*Provider>?/.test(message) ||
    // "(must be )?wrapped in (a/an) <XProvider>" — react-redux, many context libs
    /wrapped in\s+(?:an?\s+)?<?\w*Provider>?/.test(message) ||
    // react-query: "No QueryClient set, use QueryClientProvider to set one"
    /\bNo QueryClient set\b/i.test(message)
  );
}

export type RenderErrorKind = 'props' | 'runtime';

/**
 * Decide which overlay variant a caught render error deserves.
 *
 * 'runtime' — the error cannot be fixed by filling props:
 *   - a provider-context error (see {@link isProviderContextError}), OR
 *   - the component's prop schema RESOLVED to empty (it takes no props) and
 *     the error message names no prop either — nothing props-shaped remains.
 * 'props' — everything else, including `propsSchema === undefined` (schema
 *   still loading) with prop hints in the error, where the props form is a
 *   plausible fix.
 *
 * `extractedProps` is the result of `extractPropsFromError(error)` — passed in
 * (rather than re-derived) so the overlay classifies from the exact same
 * extraction it feeds to its PropsForm.
 */
export function classifyRenderError(input: {
  error: string;
  propsSchema: SimplePropInfo[] | null | undefined;
  extractedProps: readonly string[];
}): RenderErrorKind {
  const { error, propsSchema, extractedProps } = input;
  if (isProviderContextError(error)) return 'runtime';
  const schemaResolvedEmpty = Array.isArray(propsSchema) && propsSchema.length === 0;
  if (schemaResolvedEmpty && extractedProps.length === 0) return 'runtime';
  return 'props';
}
