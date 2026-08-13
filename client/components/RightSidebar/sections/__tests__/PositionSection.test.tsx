import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { PositionSection } from '../PositionSection';

const defaultProps = {
  selectedPosition: 'static' as const,
  posValues: { top: '0', right: '0', bottom: '0', left: '0' },
  projectUIKit: 'tailwind' as const,
  onPositionChange: () => {},
  onPositionValueChange: () => {},
  onPositionKeyDown: () => {},
};

describe('PositionSection toggle classes', () => {
  it('wraps toggle buttons in toggle-container', () => {
    const { container } = render(<PositionSection {...defaultProps} />);
    const toggleGroup = container.querySelector('.toggle-container');
    expect(toggleGroup).not.toBeNull();
  });

  it('applies toggle-active to selected position button', () => {
    const { container } = render(<PositionSection {...defaultProps} selectedPosition="abs" />);
    const buttons = container.querySelectorAll('button');
    const absButton = Array.from(buttons).find((b) => b.textContent === 'abs');
    expect(absButton?.classList.contains('toggle-active')).toBe(true);
  });

  it('does not apply bg-muted or bg-background to inactive buttons', () => {
    const { container } = render(<PositionSection {...defaultProps} selectedPosition="static" />);
    const buttons = container.querySelectorAll('button');
    for (const button of buttons) {
      if (button.textContent !== 'static') {
        expect(button.classList.contains('bg-muted')).toBe(false);
        expect(button.classList.contains('bg-background')).toBe(false);
      }
    }
  });

  it('does not apply old border classes to active button', () => {
    const { container } = render(<PositionSection {...defaultProps} selectedPosition="fixed" />);
    const buttons = container.querySelectorAll('button');
    const fixedButton = Array.from(buttons).find((b) => b.textContent === 'fixed');
    expect(fixedButton?.classList.contains('border-border')).toBe(false);
    expect(fixedButton?.classList.contains('bg-background')).toBe(false);
  });
});
