/**
 * @file EffectsSection write-path tests
 *
 * Accessed via: Right sidebar > Effects section when an element is selected
 * Assumptions: add-effect handler writes a valid boxShadow CSS value using hex color,
 *              not CSS custom-property syntax, so values work in any project.
 */

import { describe, expect, it, mock } from 'bun:test';
import { TID } from '@shared/data-testid-map';
import { fireEvent, render, screen } from '@testing-library/react';
import { EffectsSection } from '../EffectsSection';

describe('EffectsSection', () => {
  it('renders Effects label when no effects exist', () => {
    render(<EffectsSection effects={[]} onEffectsChange={mock()} syncStyleChange={mock()} />);
    expect(screen.getByText('Effects')).toBeTruthy();
  });

  it('add effect writes plain hex color to user CSS, not hsl(var(...))', () => {
    const syncStyleChange = mock(() => {});
    const onEffectsChange = mock(() => {});
    render(<EffectsSection effects={[]} onEffectsChange={onEffectsChange} syncStyleChange={syncStyleChange} />);

    fireEvent.click(screen.getByTestId(TID.inspector.shadowAdd));

    expect(syncStyleChange).toHaveBeenCalled();
    const boxShadowCall = (syncStyleChange.mock.calls as unknown as [string, string][]).find(
      ([key]) => key === 'boxShadow',
    );
    expect(boxShadowCall).toBeTruthy();
    const boxShadowValue = boxShadowCall?.[1] ?? '';
    expect(boxShadowValue).not.toMatch(/hsl\(var/);
  });

  it('add effect initialises effect with hex color, not CSS var', () => {
    const onEffectsChange = mock(() => {});
    render(<EffectsSection effects={[]} onEffectsChange={onEffectsChange} syncStyleChange={mock()} />);

    fireEvent.click(screen.getByTestId(TID.inspector.shadowAdd));

    expect(onEffectsChange).toHaveBeenCalled();
    const [effects] = onEffectsChange.mock.calls[0] as unknown as [Array<{ color: string }>];
    expect(effects[0].color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
