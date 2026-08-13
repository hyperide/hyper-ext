/**
 * @file Tests for shouldRetryWithAppWrapper — the render-failure-driven app-mode fallback decision.
 *
 * The helper is single-sourced in `@shared/components/preview-chrome/app-mode-fallback` and consumed
 * by BOTH the VS Code extension host (onComponentMissing / onComponentError in src/extension.ts) and
 * the SaaS canvas hook (client/.../useAppPreviewMode.ts). This ext-located suite pins the rule (the
 * ext test gate runs `bun test src/__tests__/`). Each case maps to a real wiring branch:
 *   missing+candidate → retry; error+provider-context → HYP-487 isolation owns it (no retry); the
 *   once-only latch defeats every outcome so a wrapped render that fails again never loops.
 */
import { describe, expect, it } from 'bun:test';
import { shouldRetryWithAppWrapper } from '@shared/components/preview-chrome/app-mode-fallback';

describe('shouldRetryWithAppWrapper', () => {
  it('retries for a "missing" signal on an app-entry candidate not yet tried', () => {
    expect(
      shouldRetryWithAppWrapper({
        outcome: 'missing',
        isAppEntryCandidate: true,
        isProviderContextError: false,
        alreadyTriedWrapper: false,
      }),
    ).toBe(true);
  });

  it('does NOT retry when the file is not an app-entry candidate (leaf → self-heal / HYP-487)', () => {
    expect(
      shouldRetryWithAppWrapper({
        outcome: 'missing',
        isAppEntryCandidate: false,
        isProviderContextError: false,
        alreadyTriedWrapper: false,
      }),
    ).toBe(false);
    // Same for an error on a non-candidate.
    expect(
      shouldRetryWithAppWrapper({
        outcome: 'error',
        isAppEntryCandidate: false,
        isProviderContextError: false,
        alreadyTriedWrapper: false,
      }),
    ).toBe(false);
  });

  it('does NOT retry a provider-context error — HYP-487 isolation wrapper owns that case', () => {
    expect(
      shouldRetryWithAppWrapper({
        outcome: 'error',
        isAppEntryCandidate: true, // even an app-entry candidate: provider-context is HYP-487's domain
        isProviderContextError: true,
        alreadyTriedWrapper: false,
      }),
    ).toBe(false);
  });

  it('retries a NON-provider error on an app-entry candidate not yet tried', () => {
    expect(
      shouldRetryWithAppWrapper({
        outcome: 'error',
        isAppEntryCandidate: true,
        isProviderContextError: false,
        alreadyTriedWrapper: false,
      }),
    ).toBe(true);
  });

  it('never retries twice for the same selection (once-only guard) regardless of outcome', () => {
    for (const outcome of ['missing', 'error'] as const) {
      for (const isProviderContextError of [false, true]) {
        expect(
          shouldRetryWithAppWrapper({
            outcome,
            isAppEntryCandidate: true,
            isProviderContextError,
            alreadyTriedWrapper: true,
          }),
        ).toBe(false);
      }
    }
  });

  it('ignores isProviderContextError for a "missing" signal (only meaningful for "error")', () => {
    expect(
      shouldRetryWithAppWrapper({
        outcome: 'missing',
        isAppEntryCandidate: true,
        isProviderContextError: true,
        alreadyTriedWrapper: false,
      }),
    ).toBe(true);
  });
});
