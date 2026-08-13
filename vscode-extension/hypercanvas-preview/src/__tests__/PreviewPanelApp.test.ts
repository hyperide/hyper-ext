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
  readonlyStubSentence,
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
    expect(shouldShowModeToolbar(true)).toBe(false);
  });

  it('is shown again once the user clicks Continue past the readonly stub', () => {
    // HYP-918: dev-server-unreachable suppresses the readonly stub, collapsing to this same false flag.
    expect(shouldShowModeToolbar(false)).toBe(true);
  });

  it('is shown for normal (non-readonly) projects regardless of the dismiss flag', () => {
    expect(shouldShowModeToolbar(false)).toBe(true);
    expect(shouldShowModeToolbar(false)).toBe(true);
  });
});

// HYP-1171: the stub must blame the gate that actually failed. Always-bundler
// copy told vite+emotion users "Vite does not support … use Vite"; always-CSS
// copy would lie to remix+tailwind users (review P2 on the first HYP-1171 fix).
describe('readonlyStubSentence (HYP-1171: copy keyed on the failing gate)', () => {
  it('css-gated readonly (emotion + vite) blames the CSS system, not the bundler', () => {
    const sentence = readonlyStubSentence('emotion', 'vite', 'css');
    expect(sentence).toContain('emotion');
    expect(sentence).toContain('does not support AST-based style writes');
    expect(sentence).toContain('bundler is compatible');
    expect(sentence).not.toContain('Vite does not support');
  });

  it('bundler-gated readonly (tailwind + remix) blames the bundler, not the CSS system', () => {
    const sentence = readonlyStubSentence('tailwind', 'remix', 'bundler');
    expect(sentence).toContain('Remix does not support AST-based style writes');
    expect(sentence).toContain('tailwind');
    expect(sentence).toContain('is compatible');
    expect(sentence).not.toContain('does not support AST-based style writes. The project bundler is compatible');
  });

  it('both gates failing names both', () => {
    const sentence = readonlyStubSentence('emotion', 'remix', 'both');
    expect(sentence).toContain('Remix');
    expect(sentence).toContain('emotion');
    expect(sentence).toContain('no style writer yet');
  });

  it('undefined reason falls back to the bundler copy (pre-HYP-1171 behavior)', () => {
    expect(readonlyStubSentence('emotion', 'vite', undefined)).toBe(readonlyStubSentence('emotion', 'vite', 'bundler'));
  });

  it('humanizes an unknown CSS system instead of roadmap copy about "unknown"', () => {
    const sentence = readonlyStubSentence('unknown', 'vite', 'css');
    expect(sentence).toContain('the detected CSS framework');
    expect(sentence).not.toContain('writer for unknown');
  });
});
