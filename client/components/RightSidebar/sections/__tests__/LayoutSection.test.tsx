import { describe, expect, it } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render } from '@testing-library/react';
import { LayoutSection } from '../LayoutSection';

const defaultProps = {
  selectedLayout: 'layout' as const,
  width: '100',
  height: '100',
  gap: '0',
  justifyContent: 'flex-start',
  alignItems: 'flex-start',
  columnGap: '0',
  rowGap: '0',
  gridJustifyItems: 'stretch',
  gridAlignItems: 'stretch',
  gridCols: '3',
  gridRows: '3',
  paddingTop: '0',
  paddingRight: '0',
  paddingBottom: '0',
  paddingLeft: '0',
  clipContent: false,
  projectUIKit: 'tailwind' as const,
  isStyleSyncing: false,
  onLayoutChange: () => {},
  onWidthChange: () => {},
  onHeightChange: () => {},
  onWidthBlur: () => {},
  onHeightBlur: () => {},
  onGapChange: () => {},
  onJustifyContentChange: () => {},
  onAlignItemsChange: () => {},
  onColumnGapChange: () => {},
  onRowGapChange: () => {},
  onGridJustifyItemsChange: () => {},
  onGridAlignItemsChange: () => {},
  onGridColsChange: () => {},
  onGridRowsChange: () => {},
  onPaddingChange: () => {},
  onClipContentChange: () => {},
  onNumericKeyDown: () => {},
  syncStyleChange: () => {},
};

describe('LayoutSection toggle classes', () => {
  it('wraps layout type buttons in toggle-container', () => {
    const { container } = render(<LayoutSection {...defaultProps} />);
    const toggleGroup = container.querySelector('.toggle-container');
    expect(toggleGroup).not.toBeNull();
  });

  it('applies toggle-active to selected layout button', () => {
    const { container } = render(<LayoutSection {...defaultProps} selectedLayout="col" />);
    const colButton = container.querySelector('[data-testid="hyper-inspector-layout-flex-direction"]');
    expect(colButton?.classList.contains('toggle-active')).toBe(true);
  });

  // HYP-1001: mode-icon hints render via HintTooltip (Radix, in-DOM, capturable), NOT the
  // native `title` attribute (Chromium-drawn, uncapturable by Playwright/CDP). The button
  // keeps aria-label + aria-pressed for accessibility; the hint text lives in the Radix
  // TooltipContent, which only mounts (portaled to body) on hover/focus.
  it('labels each layout-mode button with aria-label + aria-pressed and no native title (HYP-1001)', () => {
    const cases = [
      { layout: 'layout' as const, tid: TID.inspector.layoutDisplaySelect, label: 'Block layout' },
      { layout: 'col' as const, tid: TID.inspector.layoutFlexDirection, label: 'Vertical stack layout' },
      { layout: 'row' as const, tid: TID.inspector.viewToggle('row'), label: 'Horizontal stack layout' },
      { layout: 'grid' as const, tid: TID.inspector.viewToggle('grid'), label: 'Grid layout' },
    ];
    for (const { layout, tid, label } of cases) {
      const { container } = render(<LayoutSection {...defaultProps} selectedLayout={layout} />);
      const btn = container.querySelector(`[data-testid="${tid}"]`);
      expect(btn?.getAttribute('aria-label')).toBe(label);
      // No native title tooltip — it was replaced by an in-DOM Radix hint.
      expect(btn?.getAttribute('title')).toBeNull();
      expect(btn?.getAttribute('aria-pressed')).toBe('true');
    }
  });

  // HYP-1001: prove the hint is a REAL in-DOM tooltip — focusing the Block mode button makes
  // its hint text appear in the document (would fail if HintTooltip rendered nothing / a title).
  it('renders the Block mode-icon hint text in-DOM when the button is focused (HYP-1001)', async () => {
    const { container, findAllByText } = render(<LayoutSection {...defaultProps} selectedLayout="layout" />);
    const btn = container.querySelector(`[data-testid="${TID.inspector.layoutDisplaySelect}"]`) as HTMLElement;
    fireEvent.focus(btn);
    const found = await findAllByText(/Block — normal document flow/);
    expect(found.length).toBeGreaterThan(0);
  });

  it('does not apply bg-muted or bg-background to inactive buttons', () => {
    const { container } = render(<LayoutSection {...defaultProps} selectedLayout="layout" />);
    const colButton = container.querySelector('[data-testid="hyper-inspector-layout-flex-direction"]');
    expect(colButton?.classList.contains('bg-muted')).toBe(false);
    expect(colButton?.classList.contains('bg-background')).toBe(false);
  });

  it('does not apply old border classes to active button', () => {
    const { container } = render(<LayoutSection {...defaultProps} selectedLayout="row" />);
    const rowButton = container.querySelector('[data-testid="hyper-inspector-view-row"]');
    expect(rowButton?.classList.contains('border-border')).toBe(false);
    expect(rowButton?.classList.contains('bg-background')).toBe(false);
  });

  it('padding link button uses bg-transparent when not expanded', () => {
    const { getByTestId } = render(<LayoutSection {...defaultProps} selectedLayout="layout" />);
    const linkBtn = getByTestId('hyper-inspector-padding-link');
    expect(linkBtn.classList.contains('inspector-btn-active')).toBe(false);
    expect(linkBtn.classList.contains('bg-transparent')).toBe(true);
    expect(linkBtn.className).not.toContain('bg-blue-100');
    expect(linkBtn.className).not.toContain('bg-blue-900');
  });

  it('batches horizontal padding side writes', () => {
    const calls: Array<[string, string, { debounceOnly?: boolean } | undefined]> = [];
    const { getAllByTestId } = render(
      <LayoutSection {...defaultProps} syncStyleChange={(key, value, options) => calls.push([key, value, options])} />,
    );

    fireEvent.change(getAllByTestId(TID.inspector.spacingInput('padding', 'horizontal'))[0], {
      target: { value: '16' },
    });

    expect(calls).toEqual([
      ['paddingLeft', '16', { debounceOnly: true }],
      ['paddingRight', '16', { debounceOnly: true }],
    ]);
  });

  it('uses semantic theme classes for the expanded padding link', () => {
    const { getByTestId } = render(<LayoutSection {...defaultProps} />);
    const button = getByTestId(TID.inspector.spacingLink('padding'));

    fireEvent.click(button);

    expect(button.classList.contains('bg-accent')).toBe(true);
    expect(button.classList.contains('text-accent-foreground')).toBe(true);
    expect(button.className).not.toContain('bg-blue-100');
    expect(button.innerHTML).not.toContain('3479DE');
  });

  // HYP-374: asymmetric display-value bug — paddingTop="" but paddingBottom="2px"
  // means display shows "2px" but onNumericKeyDown receives paddingTop="" as currentValue.
  // The call site passes paddingTop||paddingBottom so currentValue matches the displayed value.
  it('passes display value (paddingTop||paddingBottom) as currentValue to onNumericKeyDown for vertical field', () => {
    const calls: Array<[React.KeyboardEvent<HTMLInputElement>, string, (v: string) => void, string]> = [];
    const { getByTestId } = render(
      <LayoutSection
        {...defaultProps}
        paddingTop=""
        paddingBottom="2px"
        onNumericKeyDown={(e, currentValue, setValue, styleKey) =>
          calls.push([e, currentValue, setValue, styleKey ?? ''])
        }
      />,
    );

    const verticalInput = getByTestId(TID.inspector.spacingInput('padding', 'vertical'));
    fireEvent.keyDown(verticalInput, { key: 'ArrowDown' });

    expect(calls).toHaveLength(1);
    // currentValue must match display value (paddingTop||paddingBottom = "2px"), not empty paddingTop
    expect(calls[0][1]).toBe('2px');
  });

  it('passes display value (paddingLeft||paddingRight) as currentValue to onNumericKeyDown for horizontal field', () => {
    const calls: Array<[React.KeyboardEvent<HTMLInputElement>, string, (v: string) => void, string]> = [];
    const { getByTestId } = render(
      <LayoutSection
        {...defaultProps}
        paddingLeft=""
        paddingRight="6px"
        onNumericKeyDown={(e, currentValue, setValue, styleKey) =>
          calls.push([e, currentValue, setValue, styleKey ?? ''])
        }
      />,
    );

    const horizontalInput = getByTestId(TID.inspector.spacingInput('padding', 'horizontal'));
    fireEvent.keyDown(horizontalInput, { key: 'ArrowDown' });

    expect(calls).toHaveLength(1);
    // currentValue must match display value (paddingLeft||paddingRight = "6px"), not empty paddingLeft
    expect(calls[0][1]).toBe('6px');
  });
});
