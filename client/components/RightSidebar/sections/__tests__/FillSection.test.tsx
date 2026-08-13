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
