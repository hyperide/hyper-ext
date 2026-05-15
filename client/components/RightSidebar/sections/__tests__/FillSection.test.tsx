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
});
