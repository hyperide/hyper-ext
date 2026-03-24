import { describe, expect, test } from 'bun:test';
import { shouldShowOpacity } from './opacity-input';

describe('shouldShowOpacity', () => {
  test('shows in unlinked (hex) mode regardless of system', () => {
    expect(shouldShowOpacity(false, 'tailwind')).toBe(true);
    expect(shouldShowOpacity(false, 'tamagui')).toBe(true);
  });

  test('shows in linked mode for Tailwind (supports alpha)', () => {
    expect(shouldShowOpacity(true, 'tailwind')).toBe(true);
  });

  test('hides in linked mode for Tamagui (no alpha support)', () => {
    expect(shouldShowOpacity(true, 'tamagui')).toBe(false);
  });
});
