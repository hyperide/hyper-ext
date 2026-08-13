/**
 * @file Pure decision for the render-failure-driven app-mode FALLBACK.
 *
 * Accessed via: imported as `@shared/components/preview-chrome/app-mode-fallback` by BOTH preview
 *   surfaces — the VS Code extension host (vscode-extension/.../src/extension.ts, in its
 *   `onComponentMissing` / `onComponentError` handlers) and the SaaS canvas hook
 *   (client/pages/Editor/components/hooks/useAppPreviewMode.ts, in its preview-iframe 'message'
 *   listener). Single-sourced here so the two surfaces can never drift on the rule.
 *
 * Why this exists: PR #491 made app-mode engage UPFRONT by static router-shape detection
 *   (`isAppEntryCandidate`). That was rejected — a `BrowserRouter`-owning root can still render
 *   usable UI as a plain component (matches `/`, a wildcard, a pathless route, an outer shell), so
 *   router SHAPE does not prove render FAILURE. App-mode must engage automatically ONLY as a
 *   fallback when the component-mode render did NOT work — driven by the runtime signals the
 *   generated preview already posts (`componentMissing` / `componentError`).
 *
 * Invariants:
 *   - Pure and side-effect-free (no I/O, no `window`/`document`) so it is SSR-safe and trivially
 *     unit-testable on both surfaces.
 *   - Once-only per selection: `alreadyTriedWrapper` is the caller's per-selection latch. If we
 *     already retried a selection in the full-app wrapper and it ALSO failed, the second failure
 *     surfaces the real error instead of looping (no flip-flop / infinite reload).
 *   - HYP-487 split: a provider-context CRASH on a leaf is the isolation-wrapper's domain
 *     (`.hyperide/preview.tsx`), NOT app-mode. The full-app wrapper is only for an app-ENTRY root
 *     that fails to render as a component — so we hand provider-context errors back to HYP-487 and
 *     only ever retry app-entry candidates here.
 */

/** Which runtime signal fired: nothing renderable, or a render/runtime crash. Internal — the only
 *  public surface is `shouldRetryWithAppWrapper`; both surfaces pass the literal inline. */
type RenderOutcome = 'missing' | 'error';

interface ShouldRetryWithAppWrapperArgs {
  /** Which failure signal fired for the current selection. */
  outcome: RenderOutcome;
  /** The file owns a pushState router / app-entry shell (`isAppEntryCandidate`). */
  isAppEntryCandidate: boolean;
  /** Only meaningful for `'error'`: the crash matched the provider-context pattern (HYP-487). */
  isProviderContextError: boolean;
  /** The per-selection latch — true once we've already retried this selection in the wrapper. */
  alreadyTriedWrapper: boolean;
}

/**
 * Decide whether a failed component-mode render should be RETRIED inside the full-app wrapper.
 *
 * - `alreadyTriedWrapper` → false: never retry twice for the same selection (the once-only guard
 *   that, with the missing-self-heal cap, guarantees termination — a wrapped render that fails
 *   again surfaces its real error rather than re-wrapping).
 * - NOT an app-entry candidate → false: the full-app wrapper only makes sense for an app-entry
 *   root. A plain leaf that fails goes through the existing missing-self-heal / HYP-487 isolation
 *   path, never app-mode.
 * - A provider-context `'error'` → false: that crash is HYP-487's domain (isolation wrapper). The
 *   full-app retry handles the app-entry-ROOT-fails case; a leaf crashing on a missing provider
 *   stays with HYP-487.
 * - Otherwise (`'missing'`, or a NON-provider `'error'`, on a not-yet-retried app-entry candidate)
 *   → true: render the file AS A FULL APP.
 */
export function shouldRetryWithAppWrapper({
  outcome,
  isAppEntryCandidate,
  isProviderContextError,
  alreadyTriedWrapper,
}: ShouldRetryWithAppWrapperArgs): boolean {
  if (alreadyTriedWrapper) return false;
  if (!isAppEntryCandidate) return false;
  if (outcome === 'error' && isProviderContextError) return false;
  return true;
}
