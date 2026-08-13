/**
 * @file Nudge interactivity — arrow step honors configured shiftStep; n/t/Escape route through the port
 *
 * Accessed via: Internal module, not exposed
 * Assumptions: components depend on the injected NudgeStatePort (DI), never the nudgeStore
 *   singleton. The keyboard routing (n edit / t toggle / Escape) is realm-agnostic — it lives in
 *   the NudgeHUD (mounted in both SaaS and the VS Code inspector realm) and reads the port fresh.
 * Architecture: D1-A (inspector realm), docs/specs/2026-06-04-crossrealm-webview-bridge.md
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { NudgeHUD } from '@/components/NudgeHUD/NudgeHUD';
import { NumericInput } from '@/components/ui/numeric-input';
import { createNudgeStatePort, NudgeStateProvider } from '@/lib/nudge';
import type { NudgeStatePort } from '@/lib/nudge/NudgeStatePort';

function renderFlow(port: NudgeStatePort, styleKey = 'borderWidth') {
  let current = '1px';
  const onChange = (v: string) => {
    current = v;
  };
  const utils = render(
    <NudgeStateProvider port={port}>
      <NumericInput value={current} onChange={onChange} styleKey={styleKey} testId="border-width" />
      <NudgeHUD adapter="none" />
    </NudgeStateProvider>,
  );
  return { ...utils, getValue: () => current };
}

describe('Nudge arrow step honors configured step (numeric-input)', () => {
  let port: NudgeStatePort;
  let originalActiveElement: Element | null;

  beforeEach(() => {
    port = createNudgeStatePort();
    originalActiveElement = document.activeElement;
  });

  afterEach(() => {
    if (originalActiveElement instanceof HTMLElement) originalActiveElement.blur();
  });

  test('Shift+ArrowUp uses the configured shiftStep, not the hardcoded 10', () => {
    port.getSnapshot().setShiftStep(25);
    const { getValue } = renderFlow(port);
    const input = screen.getByTestId('border-width');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    // 1px + configured shiftStep(25) = 26px. The old code added a hardcoded 10 → 11px.
    expect(getValue()).toBe('26px');
  });

  test('Alt+ArrowUp uses the configured altStep, not 1', () => {
    port.getSnapshot().setAltStep(0.5);
    const { getValue } = renderFlow(port);
    const input = screen.getByTestId('border-width');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp', altKey: true });
    // 1px + configured altStep(0.5) = 1.5px.
    expect(getValue()).toBe('1.5px');
  });

  test('a NumericInput WITHOUT styleKey keeps the plain 1/10 step (no HUD coupling)', () => {
    port.getSnapshot().setShiftStep(25);
    const { getValue } = renderFlow(port, '');
    const input = screen.getByTestId('border-width');
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    // No styleKey → not HUD-driven → fixed shift step of 10. 1 + 10 = 11px.
    expect(getValue()).toBe('11px');
  });
});

describe('Nudge HUD keyboard routing (n edit / t toggle / Escape)', () => {
  let port: NudgeStatePort;

  beforeEach(() => {
    port = createNudgeStatePort();
  });

  test('pressing n enters edit mode for the highlighted target', () => {
    port.getSnapshot().show('borderWidth', '1px');
    renderFlow(port);
    expect(port.getSnapshot().editingTarget).toBeNull();
    fireEvent.keyDown(window, { code: 'KeyN', key: 'n' });
    expect(port.getSnapshot().editingTarget).toBe(port.getSnapshot().highlightedTarget);
  });

  test('pressing t toggles between numeric and token mode', () => {
    port.getSnapshot().show('borderWidth', '1px');
    renderFlow(port);
    expect(port.getSnapshot().mode).toBe('numeric');
    fireEvent.keyDown(window, { code: 'KeyT', key: 't' });
    expect(port.getSnapshot().mode).toBe('token');
    fireEvent.keyDown(window, { code: 'KeyT', key: 't' });
    expect(port.getSnapshot().mode).toBe('numeric');
  });

  test('Escape hides the HUD when visible and not editing', () => {
    port.getSnapshot().show('borderWidth', '1px');
    renderFlow(port);
    expect(port.getSnapshot().visible).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(port.getSnapshot().visible).toBe(false);
  });

  test('Escape during edit stops editing without hiding the HUD', () => {
    port.getSnapshot().show('borderWidth', '1px');
    port.getSnapshot().startEditing('shift');
    renderFlow(port);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(port.getSnapshot().editingTarget).toBeNull();
    expect(port.getSnapshot().visible).toBe(true);
  });

  test('Escape consumed by the HUD does NOT reach the editor (no stray selection-clear)', () => {
    // The editor clears the canvas selection on a document-level Escape. When the HUD consumes
    // Escape to dismiss itself, it must stop propagation so that handler never runs.
    const editorEscape = mock(() => {});
    const docHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') editorEscape();
    };
    document.addEventListener('keydown', docHandler);
    try {
      port.getSnapshot().show('borderWidth', '1px');
      renderFlow(port);
      // Dispatch from the input (a descendant) so the event actually traverses window→document,
      // exercising the real capture→bubble path the editor's document listener sits on.
      fireEvent.keyDown(screen.getByTestId('border-width'), { key: 'Escape' });
      expect(port.getSnapshot().visible).toBe(false); // HUD dismissed
      expect(editorEscape).not.toHaveBeenCalled(); // editor handler must NOT fire
    } finally {
      document.removeEventListener('keydown', docHandler);
    }
  });

  test('keyboard routing is inert while the HUD is hidden', () => {
    renderFlow(port);
    expect(port.getSnapshot().visible).toBe(false);
    fireEvent.keyDown(window, { code: 'KeyT', key: 't' });
    expect(port.getSnapshot().mode).toBe('numeric');
    fireEvent.keyDown(window, { code: 'KeyN', key: 'n' });
    expect(port.getSnapshot().editingTarget).toBeNull();
  });

  test('modified shortcuts pass through — Cmd/Ctrl+T does NOT toggle the HUD mode', () => {
    // Regression: the HUD must not hijack Cmd+T / Ctrl+T (new tab) etc. while visible.
    port.getSnapshot().show('borderWidth', '1px');
    renderFlow(port);
    expect(port.getSnapshot().mode).toBe('numeric');
    fireEvent.keyDown(window, { code: 'KeyT', key: 't', metaKey: true });
    expect(port.getSnapshot().mode).toBe('numeric');
    fireEvent.keyDown(window, { code: 'KeyT', key: 't', ctrlKey: true });
    expect(port.getSnapshot().mode).toBe('numeric');
  });

  test('Cmd/Ctrl+S while editing is not consumed by the HUD', () => {
    port.getSnapshot().show('borderWidth', '1px');
    port.getSnapshot().startEditing('shift');
    renderFlow(port);
    fireEvent.keyDown(window, { code: 'KeyS', key: 's', metaKey: true });
    // Still editing — the HUD ignored the modified S, leaving the browser/editor save intact.
    expect(port.getSnapshot().editingTarget).toBe('shift');
  });

  test('t does NOT toggle mode while editing — would unmount the input and discard the typed value', () => {
    // Same data-loss class as KeyS: a capture-phase toggleMode() while editing swaps NumericMode for
    // TokenMode, unmounting EditNudgeInput before its typed value is applied. Guard t when editing.
    port.getSnapshot().show('borderWidth', '1px');
    port.getSnapshot().startEditing('shift');
    renderFlow(port);
    fireEvent.keyDown(window, { code: 'KeyT', key: 't' });
    expect(port.getSnapshot().mode).toBe('numeric');
    expect(port.getSnapshot().editingTarget).toBe('shift');
  });

  test('the window handler does NOT own KeyS while editing — EditNudgeInput owns apply+save', () => {
    // Regression: the capture-phase window handler ran before EditNudgeInput's onKeyDown and called
    // saveForLater()+stopEditing() with the OLD store value, unmounting the input before it could
    // apply the freshly typed value. The HUD must leave KeyS to the input while editing. We assert
    // the global handler is inert for a window-level KeyS during editing (it must NOT stopEditing).
    port.getSnapshot().show('borderWidth', '1px');
    port.getSnapshot().startEditing('shift');
    renderFlow(port);
    expect(port.getSnapshot().editingTarget).toBe('shift');
    // A KeyS that reaches window must not be hijacked into a premature save/stop by the HUD router.
    fireEvent.keyDown(window, { code: 'KeyS', key: 's' });
    expect(port.getSnapshot().editingTarget).toBe('shift');
  });
});
