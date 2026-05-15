/**
 * @file MarginSection spacing-link theme tests
 *
 * Accessed via: Right sidebar > Margin section
 * Assumptions: active spacing link styling must use theme tokens.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { render, screen } from '@testing-library/react';
import { MarginSection } from '../MarginSection';

const defaultProps = {
  marginTop: '0',
  marginRight: '0',
  marginBottom: '0',
  marginLeft: '0',
  marginLinked: true,
  onMarginChange: () => {},
  onMarginLinkedToggle: () => {},
  onNumericKeyDown: () => {},
};

describe('MarginSection spacing link', () => {
  it('uses semantic theme classes for the active linked state', () => {
    render(<MarginSection {...defaultProps} />);

    const button = screen.getByTestId(TID.inspector.spacingLink('margin'));
    expect(button.classList.contains('bg-accent')).toBe(true);
    expect(button.classList.contains('text-accent-foreground')).toBe(true);
    expect(button.className).not.toContain('bg-blue-100');
    expect(button.innerHTML).not.toContain('3479DE');
  });
});
