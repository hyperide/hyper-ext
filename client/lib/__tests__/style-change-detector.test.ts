import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock dom-utils
let mockComputedStyle: CSSStyleDeclaration | null = null;

mock.module('../dom-utils', () => ({
  getPreviewIframe: () => null,
  getElementFromIframe: () => null,
  getDOMClassesFromIframe: () => '',
  getComputedStylesFromIframe: (_elementId: string, _instanceId?: string | null) => {
    if (!mockComputedStyle) return null;
    return mockComputedStyle;
  },
}));

// Import after mocking
import {
  captureComputedStyles,
  detectUnchangedProperties,
  getCSSProperty,
  getUniqueCSSProperties,
  startStyleVerification,
} from '../style-change-detector';

describe('getCSSProperty', () => {
  it('should map shadow keys to boxShadow', () => {
    expect(getCSSProperty('shadow')).toBe('boxShadow');
    expect(getCSSProperty('shadowX')).toBe('boxShadow');
    expect(getCSSProperty('shadowY')).toBe('boxShadow');
    expect(getCSSProperty('shadowBlur')).toBe('boxShadow');
    expect(getCSSProperty('shadowSpread')).toBe('boxShadow');
    expect(getCSSProperty('shadowColor')).toBe('boxShadow');
    expect(getCSSProperty('shadowOpacity')).toBe('boxShadow');
  });

  it('should map layoutType to display', () => {
    expect(getCSSProperty('layoutType')).toBe('display');
  });

  it('should map blur to filter', () => {
    expect(getCSSProperty('blur')).toBe('filter');
  });

  it('should map border radius keys', () => {
    expect(getCSSProperty('borderRadiusTopLeft')).toBe('borderTopLeftRadius');
    expect(getCSSProperty('borderRadiusBottomRight')).toBe('borderBottomRightRadius');
  });

  it('should return identity for standard CSS properties', () => {
    expect(getCSSProperty('backgroundColor')).toBe('backgroundColor');
    expect(getCSSProperty('color')).toBe('color');
    expect(getCSSProperty('width')).toBe('width');
    expect(getCSSProperty('display')).toBe('display');
    expect(getCSSProperty('padding')).toBe('padding');
  });
});

describe('getUniqueCSSProperties', () => {
  it('should deduplicate shadow keys to single boxShadow', () => {
    const result = getUniqueCSSProperties(['shadowX', 'shadowY', 'shadowBlur', 'shadowColor']);
    expect(result).toEqual(['boxShadow']);
  });

  it('should preserve unique properties', () => {
    const result = getUniqueCSSProperties(['backgroundColor', 'color', 'width']);
    expect(result).toEqual(['backgroundColor', 'color', 'width']);
  });

  it('should deduplicate mixed keys', () => {
    const result = getUniqueCSSProperties(['shadowX', 'backgroundColor', 'shadowY']);
    expect(result).toEqual(['boxShadow', 'backgroundColor']);
  });

  it('should handle empty array', () => {
    expect(getUniqueCSSProperties([])).toEqual([]);
  });
});

describe('detectUnchangedProperties', () => {
  it('should return empty when all properties changed', () => {
    const before = { color: 'rgb(0, 0, 0)', width: '100px' };
    const after = { color: 'rgb(255, 0, 0)', width: '200px' };
    expect(detectUnchangedProperties(before, after)).toEqual([]);
  });

  it('should return unchanged property names when values match', () => {
    const before = { color: 'rgb(0, 0, 0)', width: '100px' };
    const after = { color: 'rgb(0, 0, 0)', width: '200px' };
    expect(detectUnchangedProperties(before, after)).toEqual(['color']);
  });

  it('should return all keys when nothing changed', () => {
    const before = { color: 'rgb(0, 0, 0)', width: '100px' };
    const after = { color: 'rgb(0, 0, 0)', width: '100px' };
    expect(detectUnchangedProperties(before, after)).toEqual(['color', 'width']);
  });

  it('should handle empty objects', () => {
    expect(detectUnchangedProperties({}, {})).toEqual([]);
  });
});

describe('startStyleVerification — slow HMR vs fast patch (HYP-636)', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Simulated preview state: the fast-patch !important rule shows the NEW
  // color immediately, while the underlying (real) style only changes when
  // HMR lands. `suppressed` models FastPatchService.measureWithoutPatch.
  let underlyingColor = 'rgb(255, 255, 255)';
  let patchActive = true;
  let suppressed = false;

  const suppressFastPatch = <T>(fn: () => T): T => {
    suppressed = true;
    try {
      return fn();
    } finally {
      suppressed = false;
    }
  };

  beforeEach(() => {
    underlyingColor = 'rgb(255, 255, 255)';
    patchActive = true;
    suppressed = false;
    mockComputedStyle = {
      getPropertyValue: () => (patchActive && !suppressed ? 'rgb(255, 0, 0)' : underlyingColor),
    } as unknown as CSSStyleDeclaration;
  });

  it('does not verify while only the fast patch satisfies the comparison, then verifies once HMR lands', async () => {
    let verified = 0;
    let notApplied = 0;
    let timedOut = 0;

    const cleanup = startStyleVerification({
      elementId: 'el-1',
      filePath: '/src/App.tsx',
      styles: { backgroundColor: 'red' },
      cssProperties: ['backgroundColor'],
      beforeSnapshot: { backgroundColor: 'rgb(255, 255, 255)' },
      backendPromise: Promise.resolve(),
      suppressFastPatch,
      onVerified: () => {
        verified++;
      },
      onNotApplied: () => {
        notApplied++;
      },
      onTimeout: () => {
        timedOut++;
      },
    });

    // Backend acked but HMR is slow: only the patch's !important rule shows
    // red; the underlying style is still white. Verifying here is the bug —
    // finishSync would clear the patch and flash the element white.
    await sleep(450);
    expect(verified).toBe(0);

    // HMR lands: the real class paints red without the patch.
    underlyingColor = 'rgb(255, 0, 0)';
    await sleep(500);
    expect(verified).toBe(1);
    expect(notApplied).toBe(0);
    expect(timedOut).toBe(0);

    cleanup();
  });

  it('falls back to onNotApplied after bounded retries when the real style never changes', async () => {
    let verified = 0;
    let notApplied = 0;
    let unchangedProps: string[] = [];

    const cleanup = startStyleVerification({
      elementId: 'el-1',
      filePath: '/src/App.tsx',
      styles: { backgroundColor: 'red' },
      cssProperties: ['backgroundColor'],
      beforeSnapshot: { backgroundColor: 'rgb(255, 255, 255)' },
      backendPromise: Promise.resolve(),
      suppressFastPatch,
      onVerified: () => {
        verified++;
      },
      onNotApplied: (ctx) => {
        notApplied++;
        unchangedProps = ctx.unchangedProperties;
      },
      onTimeout: () => {},
    });

    // Underlying style never changes (CSS specificity failure). After the
    // bounded HMR retries, the pipeline force-reloads; getPreviewIframe is
    // mocked to null here, so it must surface onNotApplied — not a fake
    // "verified" from the patch rule.
    await sleep(2300);
    expect(verified).toBe(0);
    expect(notApplied).toBe(1);
    expect(unchangedProps).toEqual(['backgroundColor']);

    cleanup();
  });
});

describe('captureComputedStyles', () => {
  beforeEach(() => {
    mockComputedStyle = null;
  });

  it('should return null when element not found', () => {
    mockComputedStyle = null;
    const result = captureComputedStyles('test-id', ['color']);
    expect(result).toBeNull();
  });

  it('should snapshot correct property values', () => {
    const values: Record<string, string> = {
      'background-color': 'rgb(255, 0, 0)',
      color: 'rgb(0, 0, 0)',
    };
    mockComputedStyle = {
      getPropertyValue: (prop: string) => values[prop] ?? '',
    } as unknown as CSSStyleDeclaration;

    const result = captureComputedStyles('test-id', ['backgroundColor', 'color']);
    expect(result).toEqual({
      backgroundColor: 'rgb(255, 0, 0)',
      color: 'rgb(0, 0, 0)',
    });
  });

  it('should handle properties with no value', () => {
    mockComputedStyle = {
      getPropertyValue: () => '',
    } as unknown as CSSStyleDeclaration;

    const result = captureComputedStyles('test-id', ['width']);
    expect(result).toEqual({ width: '' });
  });
});
