/**
 * @file PreviewPanelApp shell-state selection tests.
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/PreviewPanelApp.test.ts
 * Assumptions: preview shell state is derived only from devServerRunning/disconnected flags.
 * Past bugs: HYP-363 — disconnected preview snapshots captured an unstable shell between stop and rerender.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it } from 'bun:test';
import {
  getPreviewShellScreen,
  nextRenderProvenLatch,
  shouldShowModeToolbar,
} from '../webview-preview-panel/PreviewPanelApp';

describe('getPreviewShellScreen', () => {
  it('keeps a dedicated disconnected shell after a prior connection drops', () => {
    expect(getPreviewShellScreen(false, true)).toBe('disconnected');
  });

  it('shows the initial start screen before any successful connection', () => {
    expect(getPreviewShellScreen(false, false)).toBe('start');
  });

  it('shows the live preview while the dev server is running', () => {
    expect(getPreviewShellScreen(true, false)).toBe('preview');
    expect(getPreviewShellScreen(true, true)).toBe('preview');
  });
});

describe('nextRenderProvenLatch (HYP-782 readonly-stub Continue-button stability)', () => {
  const proven = { devServerRunning: true, componentError: false, showNoComponentHint: false };

  it('becomes true once the preview renders successfully', () => {
    expect(nextRenderProvenLatch(false, proven)).toBe(true);
  });

  it('STAYS true through a transient component-error blip (the mantine iframe-reload churn)', () => {
    expect(nextRenderProvenLatch(true, { ...proven, componentError: true })).toBe(true);
  });

  it('STAYS true through a transient no-selection blip', () => {
    expect(nextRenderProvenLatch(true, { ...proven, showNoComponentHint: true })).toBe(true);
  });

  it('STAYS latched through a SUSTAINED error too (deliberate tradeoff — stability over accuracy)', () => {
    // The latch can't distinguish a reload blip from a permanent break, so once
    // proven the affordance stays stable even if the error persists. Pinned so the
    // chosen behavior is intentional, not accidental.
    let latched = nextRenderProvenLatch(false, proven); // proven once
    for (let i = 0; i < 5; i++) latched = nextRenderProvenLatch(latched, { ...proven, componentError: true });
    expect(latched).toBe(true);
  });

  it('stays false before the first successful render (error present, never proven)', () => {
    expect(nextRenderProvenLatch(false, { ...proven, componentError: true })).toBe(false);
  });

  it('resets to false when the dev server goes down so a fresh session re-proves', () => {
    expect(nextRenderProvenLatch(true, { ...proven, devServerRunning: false })).toBe(false);
  });
});

describe('shouldShowModeToolbar (HYP-782: mode HUD must not overlap the readonly stub)', () => {
  // The HUD is `fixed bottom-8 ... z-[1000]`; the readonly stub is a full-surface
  // `position:absolute inset:0 z-900` overlay. With the HUD on top of the stub it
  // floated OVER the stub's "Continue in Readonly" button and intercepted its pointer
  // events (Playwright: "subtree intercepts pointer events"), wedging the user — and the
  // e2e readonly-stub spec — at the stub. While the stub covers the surface the canvas is
  // non-interactive, so the HUD must not render. This pins that gate.
  it('is HIDDEN while the readonly stub is shown — it would intercept the Continue button', () => {
    expect(shouldShowModeToolbar({ isReadonly: true, readonlyDismissed: false })).toBe(false);
  });

  it('is shown again once the user clicks Continue past the readonly stub', () => {
    expect(shouldShowModeToolbar({ isReadonly: true, readonlyDismissed: true })).toBe(true);
  });

  it('is shown for normal (non-readonly) projects regardless of the dismiss flag', () => {
    expect(shouldShowModeToolbar({ isReadonly: false, readonlyDismissed: false })).toBe(true);
    expect(shouldShowModeToolbar({ isReadonly: false, readonlyDismissed: true })).toBe(true);
  });
});
