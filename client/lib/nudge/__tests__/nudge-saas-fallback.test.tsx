/**
 * @file SaaS fallback — the HUD works with NO provider, via the singleton-backed browser port
 *
 * Accessed via: Internal module, not exposed
 * Assumptions: SaaS does NOT wrap the editor in <NudgeStateProvider>; usePort() falls back to the
 *   nudgeStore-backed browserNudgePort, which the RightSidebar numeric inputs share. This proves
 *   gap #3 — SaaS behavior is preserved after the D1-A refactor ported the HUD onto fresh main.
 * Architecture: D1-A (inspector realm), docs/specs/2026-06-04-crossrealm-webview-bridge.md
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { NudgeHUD } from '@/components/NudgeHUD/NudgeHUD';
import { NumericInput } from '@/components/ui/numeric-input';
import { nudgeStore } from '@/stores/nudgeStore';

// SaaS composition: NO <NudgeStateProvider>. Both the input and HUD must resolve to the same
// singleton-backed port so focusing the field drives the HUD.
function renderSaas(styleKey = 'borderWidth') {
  return render(
    <>
      <NumericInput value="1px" onChange={() => {}} styleKey={styleKey} testId="border-width" />
      <NudgeHUD adapter="none" />
    </>,
  );
}

describe('Nudge SaaS fallback (no provider, singleton port)', () => {
  let originalActiveElement: Element | null;

  beforeEach(() => {
    nudgeStore.getState().reset();
    originalActiveElement = document.activeElement;
  });

  afterEach(() => {
    if (originalActiveElement instanceof HTMLElement) originalActiveElement.blur();
    nudgeStore.getState().reset();
  });

  test('HUD is hidden until a styleKey input is focused (no provider)', () => {
    renderSaas();
    expect(screen.queryByTestId('nudge-hud')).toBeNull();
  });

  test('focusing the field shows the HUD through the shared singleton port', () => {
    renderSaas();
    fireEvent.focus(screen.getByTestId('border-width'));
    expect(screen.getByTestId('nudge-hud')).toBeTruthy();
    expect(screen.getByText('n edit nudge')).toBeTruthy();
    // The singleton store reflects the show(), confirming both components hit the same port.
    expect(nudgeStore.getState().visible).toBe(true);
  });

  test('keyboard routing (t toggle) works in SaaS via the singleton-backed port', () => {
    nudgeStore.getState().show('borderWidth', '1px');
    renderSaas();
    expect(nudgeStore.getState().mode).toBe('numeric');
    fireEvent.keyDown(window, { code: 'KeyT', key: 't' });
    expect(nudgeStore.getState().mode).toBe('token');
  });
});
