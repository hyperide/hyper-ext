/**
 * @file TokenCombobox — filter / select / keyboard-nav + theming regression tests
 *
 * Accessed via: Properties panel > Component Props > token fields (color/size/space)
 * Assumptions: VS Code webviews expose dark theme via body.vscode-dark, so the dropdown
 *   must use semantic tokens (bg-popover/text-foreground/bg-accent/border-border) — NOT
 *   hard-coded colors or `dark:` variants — so it themes in both realms. This component
 *   replaces the native <datalist>, which was un-themed and not width-matched.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TokenCombobox } from './token-combobox';

const TOKENS = ['$blue9', '$blue10', '$red9', '$green9', '$accent', '$color1'];

// Controlled wrapper that mirrors how PropsFormField owns the value — typing actually
// re-renders the combobox with the new value, so filtering can be asserted realistically.
function ControlledTokenCombobox({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <TokenCombobox value={value} onChange={setValue} tokens={TOKENS} listTestId="tc" />;
}

afterEach(() => {
  cleanup();
});

describe('TokenCombobox', () => {
  it('opens on focus and lists all tokens when value is empty', () => {
    render(<TokenCombobox value="" onChange={mock(() => {})} tokens={TOKENS} listTestId="tc" />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    const list = screen.getByTestId('tc');
    expect(list).toBeTruthy();
    expect(list.querySelectorAll('[role="option"]').length).toBe(TOKENS.length);
  });

  it('filters the options by what is typed (case-insensitive substring)', () => {
    render(<ControlledTokenCombobox />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    // Type "BLUE" — case-insensitive substring match should keep only the blue tokens.
    fireEvent.change(input, { target: { value: 'BLUE' } });

    const options = screen.getByTestId('tc').querySelectorAll('[role="option"]');
    expect(options.length).toBe(2); // $blue9, $blue10
    expect(Array.from(options).every((o) => o.textContent?.toLowerCase().includes('blue'))).toBe(true);
  });

  it('selects a token on click and closes the dropdown', () => {
    const onChange = mock(() => {});
    render(<TokenCombobox value="" onChange={onChange} tokens={TOKENS} listTestId="tc" />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    const redOption = Array.from(screen.getByTestId('tc').querySelectorAll('[role="option"]')).find(
      (o) => o.textContent === '$red9',
    )!;
    fireEvent.mouseDown(redOption);

    expect(onChange).toHaveBeenCalledWith('$red9');
    expect(screen.queryByTestId('tc')).toBeNull(); // closed after select
  });

  it('navigates with ArrowDown + Enter to select a token via keyboard', () => {
    const onChange = mock(() => {});
    render(<TokenCombobox value="" onChange={onChange} tokens={TOKENS} listTestId="tc" />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' }); // active = 0 ($blue9)
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // active = 1 ($blue10)
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('$blue10');
  });

  it('closes on Escape', () => {
    render(<TokenCombobox value="" onChange={mock(() => {})} tokens={TOKENS} listTestId="tc" />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(screen.getByTestId('tc')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('tc')).toBeNull();
  });

  it('closes on blur to an element outside the combobox (Tab away)', () => {
    render(<TokenCombobox value="" onChange={mock(() => {})} tokens={TOKENS} listTestId="tc" />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(screen.getByTestId('tc')).toBeTruthy();

    // Blur with relatedTarget outside the combobox container — the dropdown must close.
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(screen.queryByTestId('tc')).toBeNull();
  });

  it('shows the full token list when the value already equals a token (lets you switch)', () => {
    render(<TokenCombobox value="$blue9" onChange={mock(() => {})} tokens={TOKENS} listTestId="tc" />);
    fireEvent.focus(screen.getByRole('combobox'));
    const options = screen.getByTestId('tc').querySelectorAll('[role="option"]');
    expect(options.length).toBe(TOKENS.length); // all tokens, not just $blue9
  });

  it('uses semantic theme tokens (no hard-coded colors / dark: variants)', () => {
    render(<TokenCombobox value="" onChange={mock(() => {})} tokens={TOKENS} listTestId="tc" />);
    fireEvent.focus(screen.getByRole('combobox'));
    const list = screen.getByTestId('tc');

    expect(list.className).toContain('bg-popover');
    expect(list.className).toContain('border-border');
    expect(list.className).not.toContain('dark:');
    expect(list.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);

    const option = list.querySelector('[role="option"]')!;
    expect(option.className).toContain('text-foreground');
    expect(option.className).toContain('hover:bg-accent');
  });
});
