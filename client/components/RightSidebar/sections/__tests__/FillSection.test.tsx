/**
 * @file FillSection tests for independent text color and font size controls
 *
 * Accessed via: Right sidebar > Fill section when a text-capable element is selected
 * Assumptions: text color and font size write different style keys.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render, screen } from '@testing-library/react';
import { FillSection } from '../FillSection';

const defaultProps = {
  backgroundColor: '#ffffff',
  fillOpacity: '100',
  backgroundImage: null,
  textColor: '#111111',
  fontSize: '15px',
  fillMode: 'color' as const,
  projectUIKit: 'tailwind' as const,
  publicDirExists: false,
  activeProjectId: 'project-1',
  onBackgroundColorChange: mock(() => {}),
  onFillOpacityChange: mock(() => {}),
  onBackgroundImageChange: mock(() => {}),
  onTextColorChange: mock(() => {}),
  onFontSizeChange: mock(() => {}),
  onFillModeChange: mock(() => {}),
  syncStyleChange: mock(() => {}),
};

describe('FillSection text controls', () => {
  it('renders separate controls for text color and text size', () => {
    render(<FillSection {...defaultProps} />);

    expect(screen.getByTestId(TID.inspector.fillTextColor)).toBeTruthy();
    expect(screen.getByTestId(TID.inspector.fontSize)).toBeTruthy();
  });

  it('syncs font size changes independently from text color', () => {
    const syncStyleChange = mock(() => {});

    render(<FillSection {...defaultProps} syncStyleChange={syncStyleChange} />);

    fireEvent.change(screen.getByTestId(TID.inspector.fontSize), {
      target: { value: '16px' },
    });

    expect(syncStyleChange).toHaveBeenCalledWith('fontSize', '16px');
  });

  // HYP-1085: extend the HYP-1001 HintTooltip pattern from the Layout section to the Fill
  // section — fill color, text color, and font size each show an in-DOM hint on hover.
  it('shows an in-DOM hint for font size on hover (HYP-1085)', async () => {
    const { findAllByText } = render(<FillSection {...defaultProps} />);
    const sizeField = screen.getByTestId(TID.inspector.fontSize).closest('div') as HTMLElement;
    fireEvent.pointerEnter(sizeField);
    fireEvent.pointerMove(sizeField);
    const found = await findAllByText(/Font size/);
    expect(found.length).toBeGreaterThan(0);
  });

  it('shows an in-DOM hint for text color on hover (HYP-1085)', async () => {
    const { findAllByText } = render(<FillSection {...defaultProps} />);
    // HintTooltip wraps ColorCombobox in a plain <div> trigger (ColorCombobox doesn't spread
    // arbitrary trigger props onto its root), so the hover listeners live on that wrapper.
    const textColorField = screen.getByTestId(TID.inspector.fillTextColor).parentElement as HTMLElement;
    fireEvent.pointerEnter(textColorField);
    fireEvent.pointerMove(textColorField);
    const found = await findAllByText('Text color');
    expect(found.length).toBeGreaterThan(0);
  });

  it('shows an in-DOM hint for fill color on hover (HYP-1085)', async () => {
    const { findAllByText } = render(<FillSection {...defaultProps} />);
    const fillField = screen.getByTestId(TID.inspector.fillColorPicker).parentElement as HTMLElement;
    fireEvent.pointerEnter(fillField);
    fireEvent.pointerMove(fillField);
    const found = await findAllByText(/Fill color/);
    expect(found.length).toBeGreaterThan(0);
  });

  // Keyboard-focus parity: React's synthetic focus events bubble via focusin (unlike native
  // `focus`), so a descendant control gaining focus (e.g. a button inside FillPicker) also
  // fires the wrapping HintTooltip trigger's onFocus — tab-only users see the same hint hover
  // users get, even though the wrapper <div> itself is never a tab stop.
  it('shows the fill-color hint when a descendant control is keyboard-focused (HYP-1085)', async () => {
    const { findAllByText } = render(<FillSection {...defaultProps} backgroundColor="#0066cc" />);
    const fillRoot = screen.getByTestId(TID.inspector.fillColorPicker);
    const focusableDescendant = fillRoot.querySelector('button, input') as HTMLElement;
    expect(focusableDescendant).toBeTruthy();
    fireEvent.focus(focusableDescendant);
    const found = await findAllByText(/Fill color/);
    expect(found.length).toBeGreaterThan(0);
  });

  // Guards against the recurring "text color is display-only" false alarm: the QA
  // matrix harness cannot drive the text ColorCombobox (its hex input carries no
  // testid, so the harness aims .fill() at the non-input root <div> and reports
  // "0/14 applied"). The control IS wired — editing the hex writes `color` through
  // the same syncStyleChange path bg uses. This test pins that wiring so a future
  // harness artifact is not mistaken for a product regression.
  it('writes `color` to the style-sync path when the text hex input is edited', () => {
    const syncStyleChange = mock(() => {});
    // Raw hex (not a tailwind token) renders the ColorCombobox in unlinked mode,
    // exposing the editable hex input a partner types into.
    render(<FillSection {...defaultProps} textColor="#111111" syncStyleChange={syncStyleChange} />);

    const textControl = screen.getByTestId(TID.inspector.fillTextColor);
    const hexInput = textControl.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(hexInput).toBeTruthy();

    fireEvent.change(hexInput!, { target: { value: '22ff88' } });

    expect(syncStyleChange).toHaveBeenCalledWith('color', '#22ff88');
  });
});
