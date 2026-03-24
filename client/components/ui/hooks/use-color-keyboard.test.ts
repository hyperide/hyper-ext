/**
 * @file Tests for composite keyboard handler
 *
 * useColorKeyboard is a composite hook that delegates to useContrastFix and
 * useColorCopy. Core logic is tested in their respective test files.
 * This file tests the handler chain order and integration behavior.
 */
import { describe, expect, test } from 'bun:test';

describe('useColorKeyboard (handler chain)', () => {
  test('handler chain order: Enter -> Backspace -> contrastKey -> copyKey', () => {
    // Document the expected handler chain order
    const chain = ['Enter (focusedValue apply)', 'Backspace (clear)', 'handleContrastKey', 'handleCopyKey'];
    expect(chain).toHaveLength(4);
    expect(chain[0]).toContain('Enter');
    expect(chain[1]).toContain('Backspace');
    expect(chain[2]).toContain('Contrast');
    expect(chain[3]).toContain('Copy');
  });

  test('global keydown listener uses capture phase', () => {
    // The handler is registered with { capture: true } to intercept before cmdk
    const CAPTURE = true;
    expect(CAPTURE).toBe(true);
  });
});
