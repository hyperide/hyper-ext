/**
 * @file FillSection robustness with an UNSET fill (the inspector state the
 * "clicking fill picker does not crash inspector" e2e exercises).
 *
 * Accessed via: Right sidebar > Fill section when a leaf <h1> (transparent
 * background, no explicit color) is selected — backgroundColor resolves to ''.
 *
 * Assumptions / regression intent:
 *   - The fill picker must render gracefully for an unset fill (empty hex,
 *     empty opacity, empty text color) — no throw, no missing controls.
 *   - When the host does NOT report a public directory (publicDirExists=false,
 *     the extension preview default), the image-fill tab is rendered DISABLED.
 *     This is the exact button the e2e blindly clicked; pinning it here
 *     documents why a Playwright click on it must be guarded (a disabled button
 *     is never actionable). The inspector itself never crashes.
 */
import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { render, screen } from '@testing-library/react';
import { FillSection } from '../FillSection';

const unsetFillProps = {
  backgroundColor: '',
  fillOpacity: '',
  backgroundImage: null,
  textColor: '',
  fontSize: '',
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

describe('FillSection — unset fill robustness', () => {
  it('renders the fill picker and text controls without throwing on an empty fill', () => {
    expect(() => render(<FillSection {...unsetFillProps} />)).not.toThrow();

    expect(screen.getByTestId(TID.inspector.fillColorPicker)).toBeTruthy();
    expect(screen.getByTestId(TID.inspector.fillTextColor)).toBeTruthy();
    expect(screen.getByTestId(TID.inspector.fontSize)).toBeTruthy();
  });

  it('renders the image-fill tab DISABLED when no public directory is reported', () => {
    render(<FillSection {...unsetFillProps} />);

    // The image tab carries the "no public directory" affordance title and is
    // disabled — a blind Playwright click on it never settles (see e2e guard).
    const imageTab = screen.getByTitle(/no public directory/i);
    expect(imageTab).toBeTruthy();
    expect((imageTab as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables the image-fill tab once a public directory exists', () => {
    render(<FillSection {...unsetFillProps} publicDirExists={true} />);
    const imageTab = screen.getByTitle(/background image/i);
    expect((imageTab as HTMLButtonElement).disabled).toBe(false);
  });
});
