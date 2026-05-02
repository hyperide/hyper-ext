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
});
