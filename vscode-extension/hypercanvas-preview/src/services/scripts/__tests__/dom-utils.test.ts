/**
 * Regression coverage for the resize-handle / inspector-panel width-height agreement
 * (report: conloca-landing Hero "Get started" CtaButton — a Radix asChild/Slot shadcn <Button>
 * showing a resize handle for an axis the Layout panel labeled "Auto"). `extractComputedStyle`
 * must annotate `hcResizableWidth`/`hcResizableHeight` using the SAME `detectTailwindExplicitSize`
 * check `computeOverlayRects` uses to decide whether to draw a resize handle
 * (`shared/canvas-interaction/overlay-rects.ts`), reading the live composed className — not the
 * static source JSX className the AST-only read path sees.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { extractComputedStyle } from '../dom-utils';

function elementWithClass(className: string): HTMLElement {
  const el = document.createElement('button');
  el.className = className;
  document.body.appendChild(el);
  return el;
}

describe('extractComputedStyle — hcResizableWidth/hcResizableHeight (width/height axis agreement with the resize handle)', () => {
  // Each test appends a fixture element to the shared happy-dom `document.body` — clean up so
  // fixtures don't leak into other tests in this worker (review nit, GLM full-panel pass).
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('an explicit pixel height class (h-[34px]) is flagged resizable on the height axis', () => {
    // Mirrors the live composed className the "Get started" CtaButton renders with in
    // conloca-landing: h-[34px] present, no w-*/size-* class (width is intrinsic/hug).
    const el = elementWithClass('inline-flex items-center justify-center h-[34px] px-4 text-sm');
    const result = extractComputedStyle(el);
    expect(result.hcResizableHeight).toBe('1');
    expect(result.hcResizableWidth).toBe('0');
  });

  test('an explicit pixel width class (w-24) is flagged resizable on the width axis', () => {
    const el = elementWithClass('w-24 flex');
    const result = extractComputedStyle(el);
    expect(result.hcResizableWidth).toBe('1');
    expect(result.hcResizableHeight).toBe('0');
  });

  test('a constraint-only class (max-w-[425px], no explicit width) is NOT flagged resizable', () => {
    // Regression guard for the Tweet.tsx Action bar case the shared detector's own header
    // documents — a constraint class must never flip hcResizableWidth to '1'.
    const el = elementWithClass('flex items-center justify-between mt-3 max-w-[425px] -ml-2');
    const result = extractComputedStyle(el);
    expect(result.hcResizableWidth).toBe('0');
    expect(result.hcResizableHeight).toBe('0');
  });

  test('no size classes at all → neither axis flagged resizable', () => {
    const el = elementWithClass('flex items-center gap-2');
    const result = extractComputedStyle(el);
    expect(result.hcResizableWidth).toBe('0');
    expect(result.hcResizableHeight).toBe('0');
  });

  test('size-* class flags both axes resizable', () => {
    const el = elementWithClass('size-8 rounded-full');
    const result = extractComputedStyle(el);
    expect(result.hcResizableWidth).toBe('1');
    expect(result.hcResizableHeight).toBe('1');
  });
});
