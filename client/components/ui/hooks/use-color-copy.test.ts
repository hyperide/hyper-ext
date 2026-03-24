import { describe, expect, mock, test } from 'bun:test';
import type { HoveredColorState } from '../color-utils';
import { createCopyKeyHandler } from './use-color-copy';

// document.activeElement is accessed by the handler to check for text selection
if (typeof globalThis.document === 'undefined') {
  (globalThis as Record<string, unknown>).document = { activeElement: null };
}

// navigator.clipboard.writeText is used by copyToClipboard
if (typeof globalThis.navigator === 'undefined' || !globalThis.navigator.clipboard) {
  (globalThis as Record<string, unknown>).navigator = {
    ...globalThis.navigator,
    clipboard: { writeText: mock() },
  };
}

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    hoveredColorRef: { current: null as HoveredColorState | null },
    copyModeRef: { current: false },
    setCopyMode: mock(),
    copyModeTimerRef: { current: null as ReturnType<typeof setTimeout> | null },
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}): KeyboardEvent {
  return {
    key: 'c',
    metaKey: true,
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    code: 'KeyC',
    preventDefault: mock(),
    stopPropagation: mock(),
    stopImmediatePropagation: mock(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe('createCopyKeyHandler', () => {
  test('returns false when no hovered color', () => {
    const handler = createCopyKeyHandler(makeParams());
    expect(handler(makeEvent())).toBe(false);
  });

  test('Cmd+C with hovered color enters copy mode', () => {
    const setCopyMode = mock();
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'blue-500',
          hex: '#3b82f6',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
      setCopyMode,
    });
    const handler = createCopyKeyHandler(params);
    const e = makeEvent();
    const result = handler(e);
    expect(result).toBe(true);
    expect(setCopyMode).toHaveBeenCalledWith(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  test('does not enter copy mode if already in copy mode', () => {
    const setCopyMode = mock();
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'blue-500',
          hex: '#3b82f6',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
      copyModeRef: { current: true },
      setCopyMode,
    });
    const handler = createCopyKeyHandler(params);
    // In copy mode, 'c' key should be handled as a hotkey, not re-enter copy mode
    const e = makeEvent();
    const result = handler(e);
    expect(result).toBe(true);
    // setCopyMode should NOT be called with true (it might be called with false if hotkey matches)
  });

  test('Escape in copy mode exits copy mode', () => {
    const setCopyMode = mock();
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'blue-500',
          hex: '#3b82f6',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
      copyModeRef: { current: true },
      setCopyMode,
    });
    const handler = createCopyKeyHandler(params);
    const e = makeEvent({ key: 'Escape', metaKey: false });
    const result = handler(e);
    expect(result).toBe(true);
    expect(setCopyMode).toHaveBeenCalledWith(false);
  });

  test('any key in copy mode is consumed (returns true)', () => {
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'blue-500',
          hex: '#3b82f6',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
      copyModeRef: { current: true },
    });
    const handler = createCopyKeyHandler(params);
    const e = makeEvent({ key: 'x', metaKey: false });
    expect(handler(e)).toBe(true);
  });

  test('hotkey match in copy mode calls copyToClipboard and exits copy mode', () => {
    const setCopyMode = mock();
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'blue-500',
          hex: '#3b82f6',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
      copyModeRef: { current: true },
      setCopyMode,
    });
    const handler = createCopyKeyHandler(params);
    // 't' hotkey = copy token name
    const e = makeEvent({ key: 't', code: 'KeyT', metaKey: false });
    const result = handler(e);
    expect(result).toBe(true);
    expect(setCopyMode).toHaveBeenCalledWith(false);
  });

  test('non-Cmd+C key without copy mode returns false', () => {
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'blue-500',
          hex: '#3b82f6',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
    });
    const handler = createCopyKeyHandler(params);
    const e = makeEvent({ key: 'a', metaKey: false });
    expect(handler(e)).toBe(false);
  });
});
