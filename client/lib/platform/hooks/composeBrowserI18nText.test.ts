/**
 * @file Tests for composeBrowserI18nText — the pure seam that turns a browser-mode scan result
 *   into the inspector's I18nTextBinding. Covers the range-containment match (the selected element
 *   loc is the wrapping JSXElement, the binding loc is the inner t(...) call) and the gating that
 *   keeps the canvas path untouched (no element loc / no binding in range → undefined).
 */
import { describe, expect, test } from 'bun:test';
import type { BrowserI18nTextResult } from './useBrowserI18nText';
import { composeBrowserI18nText } from './composeBrowserI18nText';

const RESULT: BrowserI18nTextResult = {
  binding: null,
  retargetableBindings: [
    { bindingLoc: { line: 4, column: 16 }, key: 'hero.title', retargetable: true },
    { bindingLoc: { line: 7, column: 16 }, key: 'hero.subtitle', retargetable: true },
  ],
  retargetableKeys: ['hero.title', 'hero.subtitle'],
  library: 'react-i18next',
  loading: false,
  error: null,
};

// Selected element <span> at line 4 cols 6..40 wraps the t('hero.title') call at line 4 col 16.
const ELEMENT_RANGE = {
  start: { line: 4, column: 6 },
  end: { line: 4, column: 40 },
};

describe('composeBrowserI18nText', () => {
  test('builds an I18nTextBinding for the binding whose call loc is inside the element range', () => {
    const out = composeBrowserI18nText({
      result: RESULT,
      filePath: 'src/Hero.tsx',
      elementRange: ELEMENT_RANGE,
      activeLocale: 'en',
    });
    expect(out?.kind).toBe('i18n');
    if (out?.kind !== 'i18n') throw new Error('expected i18n binding');
    expect(out.key).toBe('hero.title');
    expect(out.library).toBe('react-i18next');
    // bindingLoc the retarget will use must be the t(...) CALL loc, not the element loc.
    expect(out.sourceLocation).toEqual({ filePath: 'src/Hero.tsx', line: 4, column: 16 });
    // Phase 1 is existing-key retarget only: new-key creation stays disabled.
    expect(out.writable).toBe(false);
  });

  test('picks the binding on the matching line when the element spans only part of a line', () => {
    const out = composeBrowserI18nText({
      result: RESULT,
      filePath: 'src/Hero.tsx',
      elementRange: { start: { line: 7, column: 6 }, end: { line: 7, column: 40 } },
      activeLocale: 'en',
    });
    expect(out?.kind === 'i18n' && out.key).toBe('hero.subtitle');
  });

  test('returns undefined when no binding falls within the element range (not an i18n element)', () => {
    const out = composeBrowserI18nText({
      result: RESULT,
      filePath: 'src/Hero.tsx',
      elementRange: { start: { line: 99, column: 0 }, end: { line: 99, column: 10 } },
      activeLocale: 'en',
    });
    expect(out).toBeUndefined();
  });

  test('returns undefined while loading (no flicker of a stale/empty binding)', () => {
    const out = composeBrowserI18nText({
      result: { ...RESULT, loading: true, retargetableBindings: [], retargetableKeys: [] },
      filePath: 'src/Hero.tsx',
      elementRange: ELEMENT_RANGE,
      activeLocale: 'en',
    });
    expect(out).toBeUndefined();
  });

  test('returns undefined when the element loc range is unknown', () => {
    const out = composeBrowserI18nText({
      result: RESULT,
      filePath: 'src/Hero.tsx',
      elementRange: null,
      activeLocale: 'en',
    });
    expect(out).toBeUndefined();
  });

  test('returns undefined when filePath is unknown', () => {
    const out = composeBrowserI18nText({
      result: RESULT,
      filePath: null,
      elementRange: ELEMENT_RANGE,
      activeLocale: 'en',
    });
    expect(out).toBeUndefined();
  });

  test('a multi-line element range contains a binding on an inner line', () => {
    const out = composeBrowserI18nText({
      result: RESULT,
      filePath: 'src/Hero.tsx',
      // <div> spanning lines 3..9 contains both bindings; the FIRST in range wins.
      elementRange: { start: { line: 3, column: 4 }, end: { line: 9, column: 10 } },
      activeLocale: 'en',
    });
    expect(out?.kind === 'i18n' && out.key).toBe('hero.title');
  });

  test('excludes a binding owned by a DIRECT child element (not the selected parent)', () => {
    // <div> at 3..9 contains the t('hero.title') call at 4:16, but that call lives inside a child
    // <span> at 4:6..4:38. Selecting the <div> must NOT surface the span's binding.
    const out = composeBrowserI18nText({
      result: { ...RESULT, retargetableBindings: [RESULT.retargetableBindings[0]], retargetableKeys: ['hero.title'] },
      filePath: 'src/Hero.tsx',
      elementRange: {
        start: { line: 3, column: 4 },
        end: { line: 9, column: 10 },
        childRanges: [{ start: { line: 4, column: 6 }, end: { line: 4, column: 38 } }],
      },
      activeLocale: 'en',
    });
    expect(out).toBeUndefined();
  });

  test('selecting the child itself still surfaces its binding (childRanges only exclude descendants)', () => {
    const out = composeBrowserI18nText({
      result: { ...RESULT, retargetableBindings: [RESULT.retargetableBindings[0]], retargetableKeys: ['hero.title'] },
      filePath: 'src/Hero.tsx',
      // The selected <span> directly wraps the call; it has no child element ranges.
      elementRange: { start: { line: 4, column: 6 }, end: { line: 4, column: 38 }, childRanges: [] },
      activeLocale: 'en',
    });
    expect(out?.kind === 'i18n' && out.key).toBe('hero.title');
  });

  test('returns undefined on a scan error (distinct from no-binding)', () => {
    const out = composeBrowserI18nText({
      result: { ...RESULT, error: 'boom', retargetableBindings: [], retargetableKeys: [] },
      filePath: 'src/Hero.tsx',
      elementRange: ELEMENT_RANGE,
      activeLocale: 'en',
    });
    expect(out).toBeUndefined();
  });

  test('a refreshKey-only re-scan keeps showing the binding while loading (no unmount flicker)', () => {
    // After a retarget the hook reports loading:true but RETAINS the prior bindings (same target).
    // compose must keep surfacing the binding rather than collapse the section the user just used.
    const out = composeBrowserI18nText({
      result: { ...RESULT, loading: true },
      filePath: 'src/Hero.tsx',
      elementRange: ELEMENT_RANGE,
      activeLocale: 'en',
    });
    expect(out?.kind === 'i18n' && out.key).toBe('hero.title');
  });
});
