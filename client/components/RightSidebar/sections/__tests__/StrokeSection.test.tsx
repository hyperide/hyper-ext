/**
 * @file StrokeSection editable control tests
 *
 * Accessed via: Right sidebar > Stroke section
 * Assumptions: stroke controls write CSS border properties through style sync.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render, screen } from '@testing-library/react';
import { StrokeSection } from '../StrokeSection';

const stroke = {
  id: '1',
  visible: true,
  color: '#000000',
  opacity: '100',
  width: '1',
  style: 'solid' as const,
  sides: {
    top: true,
    right: true,
    bottom: true,
    left: true,
  },
};

describe('StrokeSection', () => {
  it('uses border terminology for the inspector header', () => {
    render(<StrokeSection strokes={[stroke]} onStrokesChange={mock()} syncStyleChange={mock()} />);

    expect(screen.getByText('Border')).toBeTruthy();
  });

  it('uses border terminology for the empty add button', () => {
    render(<StrokeSection strokes={[]} onStrokesChange={mock()} syncStyleChange={mock()} />);

    expect(screen.getByText('Border')).toBeTruthy();
  });

  it('renders editable stroke controls when a stroke exists', () => {
    render(<StrokeSection strokes={[stroke]} onStrokesChange={mock()} syncStyleChange={mock()} />);

    expect(screen.getByTestId(TID.inspector.strokeColor)).toBeTruthy();
    expect(screen.getByTestId(TID.inspector.strokeWidth)).toBeTruthy();
    expect(screen.getByTestId(TID.inspector.strokeStyle)).toBeTruthy();
  });

  it('syncs stroke width and style edits', () => {
    const onStrokesChange = mock();
    const syncStyleChange = mock();

    render(<StrokeSection strokes={[stroke]} onStrokesChange={onStrokesChange} syncStyleChange={syncStyleChange} />);

    fireEvent.change(screen.getByTestId(TID.inspector.strokeWidth), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId(TID.inspector.strokeStyle), { target: { value: 'dashed' } });

    expect(syncStyleChange).toHaveBeenCalledWith('borderWidth', '3px');
    expect(syncStyleChange).toHaveBeenCalledWith('borderStyle', 'dashed');
    expect(onStrokesChange).toHaveBeenCalled();
  });

  it('renders ColorCombobox for stroke color with correct value', () => {
    render(<StrokeSection strokes={[stroke]} onStrokesChange={mock()} syncStyleChange={mock()} />);

    const colorContainer = screen.getByTestId(TID.inspector.strokeColor);
    expect(colorContainer).toBeTruthy();
  });

  it('allows border width values with explicit CSS units', () => {
    const syncStyleChange = mock();

    render(<StrokeSection strokes={[stroke]} onStrokesChange={mock()} syncStyleChange={syncStyleChange} />);

    fireEvent.change(screen.getByTestId(TID.inspector.strokeWidth), { target: { value: '0.25rem' } });

    expect(syncStyleChange).toHaveBeenCalledWith('borderWidth', '0.25rem');
  });

  it('style select renders with current stroke style value', () => {
    render(<StrokeSection strokes={[stroke]} onStrokesChange={mock(() => {})} syncStyleChange={mock(() => {})} />);
    const select = screen.getByTestId(TID.inspector.strokeStyle) as HTMLSelectElement;
    expect(select.value).toBe('solid');
  });

  it('style select change calls syncStyleChange with borderStyle', () => {
    const syncStyleChange = mock(() => {});
    const onStrokesChange = mock(() => {});
    render(<StrokeSection strokes={[stroke]} onStrokesChange={onStrokesChange} syncStyleChange={syncStyleChange} />);
    fireEvent.change(screen.getByTestId(TID.inspector.strokeStyle), { target: { value: 'dashed' } });
    expect(syncStyleChange).toHaveBeenCalledWith('borderStyle', 'dashed');
  });

  // HYP-1085: extend the HYP-1001 HintTooltip pattern (in-DOM, Radix, capturable) from the
  // Layout section to the Border (Stroke) section — color, width, and style each show a hint
  // on hover, mirroring how the Layout section's fields already behave.
  it('shows an in-DOM hint for border width on hover (HYP-1085)', async () => {
    const { findAllByText } = render(
      <StrokeSection strokes={[stroke]} onStrokesChange={mock()} syncStyleChange={mock()} />,
    );
    const widthField = screen.getByTestId(TID.inspector.strokeWidth).closest('label') as HTMLElement;
    fireEvent.pointerEnter(widthField);
    fireEvent.pointerMove(widthField);
    const found = await findAllByText(/Border width/);
    expect(found.length).toBeGreaterThan(0);
  });

  it('shows an in-DOM hint for border color on hover (HYP-1085)', async () => {
    const { findAllByText } = render(
      <StrokeSection strokes={[stroke]} onStrokesChange={mock()} syncStyleChange={mock()} />,
    );
    // HintTooltip wraps ColorCombobox in a plain <div> trigger (ColorCombobox doesn't spread
    // arbitrary trigger props onto its root), so the hover listeners live on that wrapper.
    const colorField = screen.getByTestId(TID.inspector.strokeColor).parentElement as HTMLElement;
    fireEvent.pointerEnter(colorField);
    fireEvent.pointerMove(colorField);
    const found = await findAllByText('Border color');
    expect(found.length).toBeGreaterThan(0);
  });

  it('shows an in-DOM hint for border style on hover (HYP-1085)', async () => {
    const { findAllByText } = render(
      <StrokeSection strokes={[stroke]} onStrokesChange={mock()} syncStyleChange={mock()} />,
    );
    const styleField = screen.getByTestId(TID.inspector.strokeStyle);
    fireEvent.pointerEnter(styleField);
    fireEvent.pointerMove(styleField);
    const found = await findAllByText('Border style');
    expect(found.length).toBeGreaterThan(0);
  });

  // Keyboard-focus parity (mirrors the equivalent FillSection test): React's synthetic focus
  // events bubble via focusin, so a descendant control gaining focus (e.g. the link-toggle
  // button inside ColorCombobox) also fires the wrapping HintTooltip trigger's onFocus — tab
  // users see the same hint hover users get, even though the wrapper <div> is never a tab stop.
  it('shows the border-color hint when a descendant control is keyboard-focused (HYP-1085)', async () => {
    const { findAllByText } = render(
      <StrokeSection strokes={[stroke]} onStrokesChange={mock()} syncStyleChange={mock()} />,
    );
    const colorRoot = screen.getByTestId(TID.inspector.strokeColor);
    const focusableDescendant = colorRoot.querySelector('button, input') as HTMLElement;
    expect(focusableDescendant).toBeTruthy();
    fireEvent.focus(focusableDescendant);
    const found = await findAllByText('Border color');
    expect(found.length).toBeGreaterThan(0);
  });

  it('add stroke writes plain hex to user CSS, not hsl(var(...))', () => {
    const syncStyleChange = mock(() => {});
    const onStrokesChange = mock(() => {});
    render(<StrokeSection strokes={[]} onStrokesChange={onStrokesChange} syncStyleChange={syncStyleChange} />);

    fireEvent.click(screen.getByTestId('hyper-inspector-stroke-add'));

    const borderColorCall = (syncStyleChange.mock.calls as unknown as [string, string][]).find(
      ([key]) => key === 'borderColor',
    );
    expect(borderColorCall).toBeTruthy();
    const borderColorValue = borderColorCall?.[1] ?? '';
    expect(borderColorValue).not.toMatch(/hsl\(var/);
    expect(borderColorValue).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
