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

  it('shows raw value for non-hex computed colors', () => {
    const rgbStroke = { ...stroke, color: 'rgb(15, 23, 42)' };

    render(<StrokeSection strokes={[rgbStroke]} onStrokesChange={mock()} syncStyleChange={mock()} />);

    const input = screen.getByTestId(`${TID.inspector.strokeColor}-input`) as HTMLInputElement;
    expect(input.value).toBe('rgb(15, 23, 42)');
  });

  it('allows border width values with explicit CSS units', () => {
    const syncStyleChange = mock();

    render(<StrokeSection strokes={[stroke]} onStrokesChange={mock()} syncStyleChange={syncStyleChange} />);

    fireEvent.change(screen.getByTestId(TID.inspector.strokeWidth), { target: { value: '0.25rem' } });

    expect(syncStyleChange).toHaveBeenCalledWith('borderWidth', '0.25rem');
  });
});
