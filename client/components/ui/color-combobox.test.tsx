/**
 * @file ColorCombobox theme regression tests
 *
 * Accessed via: Properties panel > Fill/Text color sections
 * Assumptions: VS Code webviews expose dark theme via body.vscode-dark, so
 * theme-sensitive controls must use semantic tokens instead of dark: variants.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { ColorCombobox } from './color-combobox';

describe('ColorCombobox link toggle theme classes', () => {
  it('uses semantic theme classes for the unlinked state', () => {
    render(
      <ColorCombobox
        value="#b8672e"
        onChange={mock(() => {})}
        tokenSystem="tailwind"
        isUnlinked={true}
        inputTestId="color-input"
      />,
    );

    const button = screen.getByTestId('color-input-link-toggle');
    expect(button.classList.contains('bg-accent')).toBe(true);
    expect(button.classList.contains('text-accent-foreground')).toBe(true);
    expect(button.className).not.toContain('amber');
    expect(button.className).not.toContain('dark:');
  });
});
