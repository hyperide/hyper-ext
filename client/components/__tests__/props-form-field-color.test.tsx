/**
 * @file PropsFormField color-dispatch tests (HYP-716, Variant A).
 *
 * Accessed via: PropsEditor renders PropsFormField for each typed prop.
 *
 * Assumptions:
 *   - A prop whose tokenCategory === 'color' renders the themed PropColorField
 *     (ColorCombobox-backed) control, NOT the native <datalist> input.
 *   - enum props still render a Select dropdown.
 *   - onChange flows through unchanged (PropsEditor wires it to syncPropToFile).
 */

import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import type { PropTypeInfo } from '@shared/types/props';
import { PropsFormField } from '../PropsFormField';

const colorProp: PropTypeInfo = { type: 'string', required: false, tokenCategory: 'color' };
const enumProp: PropTypeInfo = { type: 'enum', required: false, enumValues: ['sm', 'md', 'lg'] };

describe('PropsFormField — color-category dispatch (Variant A)', () => {
  it('routes a color-category prop to the themed control, not a native datalist', () => {
    const { container } = render(
      <PropsFormField name="color" propInfo={colorProp} value="$blue10" onChange={() => {}} uiKit="tamagui" />,
    );
    // Variant A: no native <datalist>; the ColorCombobox link-toggle button is present.
    expect(container.querySelector('datalist')).toBeNull();
    expect(container.querySelector('button[title]')).toBeTruthy();
  });

  it('renders a raw hex field for a color prop when the project has no UI kit', () => {
    const { container, getByDisplayValue } = render(
      <PropsFormField name="color" propInfo={colorProp} value="#ff0000" onChange={() => {}} uiKit="none" />,
    );
    expect(container.querySelector('datalist')).toBeNull();
    expect(getByDisplayValue('#ff0000')).toBeTruthy();
  });

  it('still renders an enum prop as a Select dropdown (unchanged)', () => {
    const { container } = render(
      <PropsFormField name="size" propInfo={enumProp} value="md" onChange={() => {}} uiKit="tamagui" />,
    );
    // Radix Select renders a combobox-role trigger button, no datalist.
    expect(container.querySelector('[role="combobox"], button')).toBeTruthy();
    expect(container.querySelector('datalist')).toBeNull();
  });
});
