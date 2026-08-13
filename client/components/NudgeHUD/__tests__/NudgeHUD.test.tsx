/**
 * @file Tests for NudgeHUD component — numeric mode rendering, visibility, token preview
 *
 * Accessed via: Internal module, not exposed
 * Assumptions: test/setup-dom.ts preloaded via bunfig.toml (happy-dom globals registered)
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { nudgeStore } from '@/stores/nudgeStore';
import { NudgeHUD } from '../NudgeHUD';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  nudgeStore.getState().reset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function renderHUD(adapter: 'tailwind' | 'tamagui' | 'none') {
  flushSync(() => {
    root.render(createElement(NudgeHUD, { adapter }));
  });
}

function html(): string {
  return container.innerHTML;
}

describe('NudgeHUD', () => {
  test('hidden when not visible', () => {
    renderHUD('tailwind');
    expect(html()).toBe('');
  });

  test('renders when visible in numeric mode', () => {
    nudgeStore.getState().show('width', '240px');
    renderHUD('tailwind');
    const output = html();
    expect(output).toContain('data-testid="nudge-hud"');
    expect(output).toContain('Alt');
    expect(output).toContain('Shift');
  });

  test('shows direction indicator', () => {
    nudgeStore.getState().show('width', '240px');
    renderHUD('tailwind');
    expect(html()).toContain('<svg');
  });

  test('shows nearest token preview for exact match', () => {
    nudgeStore.getState().show('width', '240px');
    renderHUD('tailwind');
    expect(html()).toContain('w-60');
  });

  test('shows approximate indicator for non-exact token match', () => {
    nudgeStore.getState().show('width', '227px');
    renderHUD('tailwind');
    expect(html()).toContain('\u2248');
  });

  test('shows n edit nudge shortcut hint', () => {
    nudgeStore.getState().show('width', '240px');
    renderHUD('tailwind');
    expect(html()).toContain('n edit nudge');
  });

  test('adapter=none hides token features, shows numeric only', () => {
    nudgeStore.getState().show('width', '240px');
    renderHUD('none');
    const output = html();
    expect(output).toContain('data-testid="nudge-hud"');
    expect(output).toContain('Alt');
    expect(output).not.toContain('w-60');
  });
});

describe('NudgeHUD token mode', () => {
  test('renders pagination for spacing tokens', () => {
    nudgeStore.getState().show('width', '240px');
    nudgeStore.getState().toggleMode();
    renderHUD('tailwind');
    const output = html();
    // 240px = w-60, should show pagination with neighbors
    expect(output).toContain('w-60');
    expect(output).toContain('w-56');
    expect(output).toContain('w-64');
  });

  test('renders all values for short scales (border-radius)', () => {
    nudgeStore.getState().show('borderRadius', '8px');
    nudgeStore.getState().toggleMode();
    renderHUD('tailwind');
    const output = html();
    expect(output).toContain('none');
    expect(output).toContain('full');
  });

  test('shows special values via Shift for width', () => {
    nudgeStore.getState().show('width', '240px');
    nudgeStore.getState().toggleMode();
    renderHUD('tailwind');
    const output = html();
    expect(output).toContain('auto');
    expect(output).toContain('full');
  });

  test('shows t with raw CSS value', () => {
    nudgeStore.getState().show('width', '240px');
    nudgeStore.getState().toggleMode();
    renderHUD('tailwind');
    const output = html();
    expect(output).toContain('240px');
  });

  test('hides Shift section when no specials exist', () => {
    nudgeStore.getState().show('padding', '16px');
    nudgeStore.getState().toggleMode();
    renderHUD('tailwind');
    const output = html();
    expect(output).not.toContain('icon-tabler-arrow-big-up');
  });

  test('does not duplicate first/last token at scale edges', () => {
    nudgeStore.getState().show('width', '0px');
    nudgeStore.getState().toggleMode();
    renderHUD('tailwind');
    const output = html();
    // w-0 should appear exactly once (as current token), not duplicated as first+current
    const matches = output.match(/>w-0</g) ?? [];
    expect(matches.length).toBe(1);
  });

  test('renders color swatches for backgroundColor', () => {
    nudgeStore.getState().show('backgroundColor', '#3b82f6');
    nudgeStore.getState().toggleMode();
    renderHUD('tailwind');
    const output = html();
    expect(output).toContain('500');
    expect(output).toContain('data-testid="color-swatch"');
  });
});
