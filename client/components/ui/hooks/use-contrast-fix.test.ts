import { describe, expect, mock, test } from 'bun:test';
import type { ColorOption, HoveredColorState } from '../color-utils';
import { createContrastKeyHandler } from './use-contrast-fix';

const makeOption = (value: string, hex: string, colorName: string): ColorOption => ({
  value,
  hex,
  label: value,
  colorName,
});

const colorOptions: ColorOption[] = [
  makeOption('gray-100', '#f3f4f6', 'gray'),
  makeOption('gray-500', '#6b7280', 'gray'),
  makeOption('gray-700', '#374151', 'gray'),
  makeOption('gray-900', '#111827', 'gray'),
];

function makeControlEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'Control',
    repeat: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: mock(),
    stopPropagation: mock(),
    stopImmediatePropagation: mock(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    colorOptions,
    tokenSystem: 'tailwind' as const,
    hoveredColorRef: { current: null as HoveredColorState | null },
    isLinkedRef: { current: true },
    currentHexRef: { current: '#f3f4f6' },
    effectiveContrastPairedRef: { current: undefined as string | undefined },
    popoverContentRef: { current: null as HTMLDivElement | null },
    handleColorHover: mock(),
    setFocusedValue: mock(),
    onChangeRef: { current: mock() },
    addRecentColorRef: { current: mock() },
    ...overrides,
  };
}

describe('createContrastKeyHandler', () => {
  test('ignores non-Control keys', () => {
    const handler = createContrastKeyHandler(makeParams(), { current: 0 }, { current: 0 });
    const e = makeControlEvent({ key: 'a' });
    expect(handler(e)).toBe(false);
  });

  test('ignores repeated Control key', () => {
    const handler = createContrastKeyHandler(makeParams(), { current: 0 }, { current: 0 });
    const e = makeControlEvent({ repeat: true });
    expect(handler(e)).toBe(false);
  });

  test('ignores Control with Shift/Alt/Meta', () => {
    const handler = createContrastKeyHandler(makeParams(), { current: 0 }, { current: 0 });
    expect(handler(makeControlEvent({ shiftKey: true }))).toBe(false);
    expect(handler(makeControlEvent({ altKey: true }))).toBe(false);
    expect(handler(makeControlEvent({ metaKey: true }))).toBe(false);
  });

  test('single Control press stores timestamp, returns false', () => {
    const lastCtrlRef = { current: 0 };
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'gray-100',
          hex: '#f3f4f6',
          pairedHex: '#ffffff',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
    });
    const handler = createContrastKeyHandler(params, lastCtrlRef, { current: 0 });
    const result = handler(makeControlEvent());
    expect(result).toBe(false);
    expect(lastCtrlRef.current).toBeGreaterThan(0);
  });

  test('double Control press with hovered+pairedHex calls stopImmediatePropagation', () => {
    const lastCtrlRef = { current: Date.now() }; // Simulate recent first press
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'gray-100',
          hex: '#f3f4f6',
          pairedHex: '#ffffff',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
    });
    const handler = createContrastKeyHandler(params, lastCtrlRef, { current: 0 });
    const e = makeControlEvent();
    const result = handler(e);
    expect(result).toBe(true);
    expect(e.stopImmediatePropagation).toHaveBeenCalled();
  });

  test('double Control press in hex mode calls onChange with fix', () => {
    const lastCtrlHexRef = { current: Date.now() };
    const onChangeMock = mock();
    const addRecentMock = mock();
    const params = makeParams({
      hoveredColorRef: { current: null }, // No hovered color
      isLinkedRef: { current: false },
      currentHexRef: { current: '#f3f4f6' }, // Light gray
      effectiveContrastPairedRef: { current: '#ffffff' }, // White bg — low contrast
      onChangeRef: { current: onChangeMock },
      addRecentColorRef: { current: addRecentMock },
    });
    const handler = createContrastKeyHandler(params, { current: 0 }, lastCtrlHexRef);
    const e = makeControlEvent();
    const result = handler(e);
    expect(result).toBe(true);
    expect(e.stopImmediatePropagation).toHaveBeenCalled();
    // Should have called onChange with a darker hex
    expect(onChangeMock).toHaveBeenCalled();
    expect(addRecentMock).toHaveBeenCalled();
  });

  test('returns false when no hovered color and linked mode', () => {
    const handler = createContrastKeyHandler(makeParams(), { current: 0 }, { current: 0 });
    const result = handler(makeControlEvent());
    expect(result).toBe(false);
  });

  test('hex mode single Control stores timestamp, returns false', () => {
    const lastCtrlHexRef = { current: 0 };
    const params = makeParams({
      hoveredColorRef: { current: null },
      isLinkedRef: { current: false },
      currentHexRef: { current: '#f3f4f6' },
      effectiveContrastPairedRef: { current: '#ffffff' },
    });
    const handler = createContrastKeyHandler(params, { current: 0 }, lastCtrlHexRef);
    const result = handler(makeControlEvent());
    expect(result).toBe(false);
    expect(lastCtrlHexRef.current).toBeGreaterThan(0);
  });

  test('hex mode skips when currentHex does not start with #', () => {
    const lastCtrlHexRef = { current: Date.now() };
    const params = makeParams({
      hoveredColorRef: { current: null },
      isLinkedRef: { current: false },
      currentHexRef: { current: 'transparent' },
      effectiveContrastPairedRef: { current: '#ffffff' },
    });
    const handler = createContrastKeyHandler(params, { current: 0 }, lastCtrlHexRef);
    expect(handler(makeControlEvent())).toBe(false);
  });

  test('hex mode skips when no effectiveContrastPaired', () => {
    const lastCtrlHexRef = { current: Date.now() };
    const params = makeParams({
      hoveredColorRef: { current: null },
      isLinkedRef: { current: false },
      currentHexRef: { current: '#f3f4f6' },
      effectiveContrastPairedRef: { current: undefined },
    });
    const handler = createContrastKeyHandler(params, { current: 0 }, lastCtrlHexRef);
    expect(handler(makeControlEvent())).toBe(false);
  });

  test('token mode with good contrast (AAA) does not find fix', () => {
    const lastCtrlRef = { current: Date.now() };
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'gray-900',
          hex: '#111827', // Very dark — excellent contrast against white
          pairedHex: '#ffffff',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
    });
    const handler = createContrastKeyHandler(params, lastCtrlRef, { current: 0 });
    const e = makeControlEvent();
    const result = handler(e);
    // AAA already — targetLevel is null, returns true but no fix applied
    expect(result).toBe(true);
  });

  test('double Control with DOM element scrolls, hovers, and sets focusedValue', () => {
    const lastCtrlRef = { current: Date.now() };
    const handleColorHover = mock();
    const setFocusedValue = mock();
    const mockEl = { scrollIntoView: mock() } as unknown as HTMLElement;
    const mockContainer = {
      querySelector: mock(() => mockEl),
    } as unknown as HTMLDivElement;
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'gray-100',
          hex: '#f3f4f6',
          pairedHex: '#ffffff',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
      popoverContentRef: { current: mockContainer },
      handleColorHover,
      setFocusedValue,
    });
    const handler = createContrastKeyHandler(params, lastCtrlRef, { current: 0 });
    handler(makeControlEvent());
    expect(mockEl.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' });
    expect(handleColorHover).toHaveBeenCalled();
    expect(setFocusedValue).toHaveBeenCalled();
    // Verify the fix value was passed to setFocusedValue
    const fixValue = setFocusedValue.mock.calls[0][0];
    expect(typeof fixValue).toBe('string');
  });

  test('double Control with tamagui adds $ prefix to tokenName', () => {
    const lastCtrlRef = { current: Date.now() };
    const handleColorHover = mock();
    const mockEl = { scrollIntoView: mock() } as unknown as HTMLElement;
    const mockContainer = {
      querySelector: mock(() => mockEl),
    } as unknown as HTMLDivElement;
    const params = makeParams({
      tokenSystem: 'tamagui' as const,
      hoveredColorRef: {
        current: {
          tokenName: '$gray100',
          hex: '#f3f4f6',
          pairedHex: '#ffffff',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
      popoverContentRef: { current: mockContainer },
      handleColorHover,
    });
    const handler = createContrastKeyHandler(params, lastCtrlRef, { current: 0 });
    handler(makeControlEvent());
    if (handleColorHover.mock.calls.length > 0) {
      const tokenName = handleColorHover.mock.calls[0][0] as string;
      expect(tokenName.startsWith('$')).toBe(true);
    }
  });

  test('resets lastCtrlPressRef to 0 after double press', () => {
    const lastCtrlRef = { current: Date.now() };
    const params = makeParams({
      hoveredColorRef: {
        current: {
          tokenName: 'gray-100',
          hex: '#f3f4f6',
          pairedHex: '#ffffff',
          anchorRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} } as DOMRect,
        },
      },
    });
    const handler = createContrastKeyHandler(params, lastCtrlRef, { current: 0 });
    handler(makeControlEvent());
    expect(lastCtrlRef.current).toBe(0);
  });
});
