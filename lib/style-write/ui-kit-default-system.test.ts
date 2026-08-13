import { describe, expect, it } from 'bun:test';
import { uiKitToDefaultCssSystem } from './ui-kit-default-system';

describe('uiKitToDefaultCssSystem', () => {
  it('maps a Tailwind project to tailwind-v4 (surfaceless floor lands a class, not inline)', () => {
    expect(uiKitToDefaultCssSystem('tailwind')).toBe('tailwind-v4');
  });

  it('maps a Tamagui project to tamagui', () => {
    expect(uiKitToDefaultCssSystem('tamagui')).toBe('tamagui');
  });

  it('returns undefined for a non-UIKit project (cascade falls through, never a silent skip)', () => {
    expect(uiKitToDefaultCssSystem('none')).toBeUndefined();
    expect(uiKitToDefaultCssSystem(undefined)).toBeUndefined();
    expect(uiKitToDefaultCssSystem(null)).toBeUndefined();
    expect(uiKitToDefaultCssSystem('unknown')).toBeUndefined();
  });
});
