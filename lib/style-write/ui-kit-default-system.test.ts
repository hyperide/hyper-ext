import { describe, expect, it } from 'bun:test';
import { uiKitToDefaultCssSystem } from './ui-kit-default-system';
import type { UiKitLabel } from '../ui-kit';

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
  });

  it('returns undefined defensively for a runtime value outside the UiKitLabel union (e.g. a stale/renamed label smuggled in from an untyped source)', () => {
    expect(uiKitToDefaultCssSystem('unknown' as UiKitLabel)).toBeUndefined();
  });
});
