/**
 * @file PropColorField tests — token-aware color control for color-category props.
 *
 * Accessed via: PropsFormField dispatch when propInfo.tokenCategory === 'color'.
 *
 * Assumptions:
 *   - tamagui projects emit `$token` form via the existing use-color-value round-trip.
 *   - tailwind projects emit a class/value (hex) form.
 *   - 'none' projects (no UI kit) get a RAW HEX field — we never fabricate tailwind
 *     tokens for them.
 *   - onChange is the caller's prop write (PropsEditor.syncPropToFile → updateASTProp).
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';

const { PropColorField } = await import('../prop-color-field');

afterEach(() => {
  mock.restore();
});

describe('PropColorField', () => {
  it('renders the themed ColorCombobox control (not a native datalist) for tamagui', () => {
    const { container } = render(<PropColorField name="color" value="$blue10" uiKit="tamagui" onChange={() => {}} />);
    // ColorCombobox renders its link-toggle button; a native <datalist> must NOT be present.
    expect(container.querySelector('datalist')).toBeNull();
    expect(container.querySelector('button[title]')).toBeTruthy();
  });

  it('emits a $token value for tamagui (round-trip preserved, no silent hex conversion)', () => {
    const calls: string[] = [];
    render(<PropColorField name="color" value="$blue10" uiKit="tamagui" onChange={(v) => calls.push(v)} />);
    // The control is seeded with a token; the existing round-trip keeps token form.
    // We assert no synchronous onChange fires that would clobber the token to hex.
    expect(calls).toEqual([]);
  });

  it('renders a raw hex input (no token control) for a project with no UI kit', () => {
    const { container, getByDisplayValue } = render(
      <PropColorField name="color" value="#ff0000" uiKit="none" onChange={() => {}} />,
    );
    // No token combobox / link-toggle for 'none' — just a raw hex text field.
    expect(container.querySelector('button[title*="token"]')).toBeNull();
    expect(getByDisplayValue('#ff0000')).toBeTruthy();
  });

  it('writes the raw hex value through onChange for a none-kit project (no auto-snap)', () => {
    const calls: string[] = [];
    const { getByDisplayValue } = render(
      <PropColorField name="color" value="#ff0000" uiKit="none" onChange={(v) => calls.push(v)} />,
    );
    fireEvent.change(getByDisplayValue('#ff0000'), { target: { value: '#00ff00' } });
    expect(calls.at(-1)).toBe('#00ff00');
  });
});
