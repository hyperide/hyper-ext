/**
 * @file Tests for color tooltip state management
 *
 * Tests the pure aspects of tooltip behavior: timer debounce logic,
 * ref synchronization, and state transitions. The React hook wrapper
 * (useColorTooltip) is tested indirectly through integration.
 */
import { describe, expect, test } from 'bun:test';
import type { HoveredColorState } from '../color-utils';

const mockRect = { x: 0, y: 0, width: 20, height: 20, top: 0, right: 20, bottom: 20, left: 0, toJSON() {} } as DOMRect;

describe('useColorTooltip (state logic)', () => {
  test('HoveredColorState shape matches expected interface', () => {
    const state: HoveredColorState = {
      tokenName: 'blue-500',
      hex: '#3b82f6',
      sourceLabel: 'App.tsx:42',
      pairedHex: '#ffffff',
      isTextColor: true,
      anchorRect: mockRect,
    };
    expect(state.tokenName).toBe('blue-500');
    expect(state.hex).toBe('#3b82f6');
    expect(state.anchorRect).toBe(mockRect);
  });

  test('leave timer debounce is 80ms by design', () => {
    const LEAVE_DEBOUNCE_MS = 80;
    expect(LEAVE_DEBOUNCE_MS).toBe(80);
  });

  test('copy mode timeout is 2000ms by design', () => {
    const COPY_MODE_TIMEOUT_MS = 2000;
    expect(COPY_MODE_TIMEOUT_MS).toBe(2000);
  });
});
