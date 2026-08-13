/**
 * @file NudgeStatePort flow — input focus drives the in-realm HUD via the port (no singleton)
 *
 * Accessed via: Internal module, not exposed
 * Assumptions: components depend on the NudgeStatePort through context, never on the
 *   module-level nudgeStore singleton; the provider backs the port with an in-realm store.
 * Architecture: D1-A (inspector realm), docs/specs/2026-06-04-crossrealm-webview-bridge.md
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { NudgeHUD } from '@/components/NudgeHUD/NudgeHUD';
import { NumericInput } from '@/components/ui/numeric-input';
import { createNudgeStatePort, NudgeStateProvider } from '@/lib/nudge';

function renderFlow(styleKey?: string) {
  // A fresh port per test → no cross-test leakage from a module singleton.
  const port = createNudgeStatePort();
  const utils = render(
    <NudgeStateProvider port={port}>
      <NumericInput value="1px" onChange={() => {}} styleKey={styleKey} testId="border-width" />
      <NudgeHUD adapter="none" />
    </NudgeStateProvider>,
  );
  return { port, ...utils };
}

describe('NudgeStatePort flow (D1-A, inspector realm)', () => {
  let originalActiveElement: Element | null;

  beforeEach(() => {
    originalActiveElement = document.activeElement;
  });

  afterEach(() => {
    if (originalActiveElement instanceof HTMLElement) originalActiveElement.blur();
  });

  test('HUD is hidden before any input is focused', () => {
    renderFlow('borderWidth');
    expect(screen.queryByTestId('nudge-hud')).toBeNull();
  });

  test('focusing a styleKey NumericInput shows the HUD via the port', () => {
    renderFlow('borderWidth');
    const input = screen.getByTestId('border-width');
    fireEvent.focus(input);
    expect(screen.getByTestId('nudge-hud')).toBeTruthy();
    expect(screen.getByText('n edit nudge')).toBeTruthy();
  });

  test('a NumericInput without styleKey never shows the HUD', () => {
    renderFlow(undefined);
    const input = screen.getByTestId('border-width');
    fireEvent.focus(input);
    expect(screen.queryByTestId('nudge-hud')).toBeNull();
  });

  test('the port snapshot reflects show(), proving components read the injected port', () => {
    const { port } = renderFlow('borderWidth');
    expect(port.getSnapshot().visible).toBe(false);
    const input = screen.getByTestId('border-width');
    fireEvent.focus(input);
    expect(port.getSnapshot().visible).toBe(true);
    expect(port.getSnapshot().activeProperty).toBe('borderWidth');
  });
});

describe('currentValue sync on typing (HYP-589 bug 1)', () => {
  // Bug: NumericInput only called updateCurrentValue on ArrowUp/ArrowDown. Manual typing/paste
  // left store currentValue stale — token mode (t) then operated on the old value.
  // Fix: NumericInput onChange must also call nudge.updateCurrentValue(newValue).

  test('typing into a styleKey NumericInput keeps HUD currentValue in sync', () => {
    // Render with a controlled value so we can simulate a change event.
    let controlledValue = '240px';
    const onChange = (v: string) => {
      controlledValue = v;
    };
    const port = createNudgeStatePort();
    render(
      <NudgeStateProvider port={port}>
        <NumericInput value={controlledValue} onChange={onChange} styleKey="width" testId="width-input" />
        <NudgeHUD adapter="none" />
      </NudgeStateProvider>,
    );

    const input = screen.getByTestId('width-input');
    fireEvent.focus(input);
    // Store currentValue was set by show() to '240px' on focus
    expect(port.getSnapshot().currentValue).toBe('240px');

    // User types a new value directly (not via arrow keys)
    fireEvent.change(input, { target: { value: '300px' } });

    // currentValue must update in the store so token mode reads the fresh value
    expect(port.getSnapshot().currentValue).toBe('300px');
  });

  test('pasting into a styleKey NumericInput keeps HUD currentValue in sync', () => {
    let controlledValue = '0px';
    const onChange = (v: string) => {
      controlledValue = v;
    };
    const port = createNudgeStatePort();
    render(
      <NudgeStateProvider port={port}>
        <NumericInput value={controlledValue} onChange={onChange} styleKey="fontSize" testId="font-size-input" />
        <NudgeHUD adapter="none" />
      </NudgeStateProvider>,
    );

    const input = screen.getByTestId('font-size-input');
    fireEvent.focus(input);

    // Simulate paste by firing a change event (browsers normalise paste → change)
    fireEvent.change(input, { target: { value: '1.5rem' } });

    expect(port.getSnapshot().currentValue).toBe('1.5rem');
  });

  test('NumericInput WITHOUT styleKey does NOT call updateCurrentValue on change (no HUD coupling)', () => {
    let controlledValue = '4px';
    const onChange = (v: string) => {
      controlledValue = v;
    };
    const port = createNudgeStatePort();
    render(
      <NudgeStateProvider port={port}>
        <NumericInput value={controlledValue} onChange={onChange} testId="plain-input" />
        <NudgeHUD adapter="none" />
      </NudgeStateProvider>,
    );

    const input = screen.getByTestId('plain-input');
    fireEvent.change(input, { target: { value: '8px' } });

    // No styleKey → HUD should not be touched
    expect(port.getSnapshot().currentValue).toBe('');
  });
});
