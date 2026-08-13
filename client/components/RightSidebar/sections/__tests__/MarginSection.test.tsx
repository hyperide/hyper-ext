import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render } from '@testing-library/react';
import { MarginSection } from '../MarginSection';

const defaultProps = {
  marginTop: '0',
  marginRight: '0',
  marginBottom: '0',
  marginLeft: '0',
  marginLinked: false,
  onMarginChange: () => {},
  onMarginLinkedToggle: () => {},
  onNumericKeyDown: () => {},
};

describe('MarginSection link button', () => {
  it('uses bg-transparent when marginLinked is false', () => {
    const { getByTestId } = render(<MarginSection {...defaultProps} marginLinked={false} />);
    const linkBtn = getByTestId(TID.inspector.spacingLink('margin'));
    expect(linkBtn.classList.contains('bg-transparent')).toBe(true);
    expect(linkBtn.classList.contains('inspector-btn-active')).toBe(false);
  });

  it('uses inspector-btn-active when marginLinked is true', () => {
    const { getByTestId } = render(<MarginSection {...defaultProps} marginLinked={true} />);
    const linkBtn = getByTestId(TID.inspector.spacingLink('margin'));
    expect(linkBtn.classList.contains('inspector-btn-active')).toBe(true);
    expect(linkBtn.classList.contains('bg-transparent')).toBe(false);
  });

  it('inactive link button has no hardcoded blue Tailwind classes', () => {
    const { getByTestId } = render(<MarginSection {...defaultProps} marginLinked={false} />);
    const btn = getByTestId(TID.inspector.spacingLink('margin'));
    expect(btn.className).not.toContain('bg-blue-100');
    expect(btn.className).not.toContain('bg-blue-900');
  });

  it('active link button has no hardcoded blue Tailwind classes', () => {
    const { getByTestId } = render(<MarginSection {...defaultProps} marginLinked={true} />);
    const btn = getByTestId(TID.inspector.spacingLink('margin'));
    expect(btn.className).not.toContain('bg-blue-100');
    expect(btn.className).not.toContain('bg-blue-900');
  });

  it('calls onMarginLinkedToggle when link button is clicked', () => {
    const toggle = mock(() => {});
    const { getByTestId } = render(<MarginSection {...defaultProps} onMarginLinkedToggle={toggle} />);
    fireEvent.click(getByTestId(TID.inspector.spacingLink('margin')));
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
