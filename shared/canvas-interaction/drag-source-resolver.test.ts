/**
 * @file Tests for drag source resolution (drag-source-resolver.ts)
 *
 * Accessed via: Internal module, not exposed
 *
 * Covers:
 * - Direct element with source (happy path)
 * - Decorative element (emoji, aria-hidden) → walk-up to ancestor
 * - Cold source maps → _debugSource fallback (the bug this file fixes)
 * - No source anywhere → null (drag blocked)
 * - Multi-select badge: state.selectedIds.length exposed for badge rendering
 */

import { describe, expect, it, mock } from 'bun:test';
import type { Fiber } from '../element-tracing/fiber-internals';
import type { SourceLocation } from '../element-tracing/types';
import { resolveDragSource } from './drag-source-resolver';

/* ─── Helpers ────────────────────────────────────────────────────── */

function makeEl(
  overrides: Partial<HTMLElement & { __reactFiber$test?: unknown }> = {},
  attrs: Record<string, string> = {},
): HTMLElement {
  const el = {
    tagName: 'SPAN',
    parentElement: null,
    getAttribute: (name: string) => attrs[name] ?? null,
    ...overrides,
  } as unknown as HTMLElement;
  return el;
}

function makeFiber(overrides: Partial<Fiber> = {}): Fiber {
  return {
    tag: 5,
    type: 'p',
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    memoizedProps: {},
    _debugSource: null,
    _debugOwner: null,
    ...overrides,
  };
}

const SOURCE_P: SourceLocation = { fileName: '/src/App.tsx', line: 12, column: 4 };

/* ─── Tests ──────────────────────────────────────────────────────── */

describe('resolveDragSource', () => {
  it('returns source for element that resolves directly', () => {
    const target = makeEl();
    const getSourceLocation = mock((el: HTMLElement) => (el === target ? SOURCE_P : null));

    const result = resolveDragSource(target, getSourceLocation, '/src/App.tsx');

    expect(result).not.toBeNull();
    expect(result?.source).toEqual(SOURCE_P);
    expect(result?.el).toBe(target);
  });

  it('walks up to parent when target is a decorative element (emoji, aria-hidden span)', () => {
    const parent = makeEl({ tagName: 'P' });
    const emojiSpan = makeEl({ tagName: 'SPAN', parentElement: parent });
    // parent chain ends at document.body sentinel
    (parent as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };

    // emoji span has no source; parent <p> does
    const getSourceLocation = mock((el: HTMLElement) => {
      if (el === parent) return SOURCE_P;
      return null;
    });

    const result = resolveDragSource(emojiSpan, getSourceLocation, '/src/App.tsx');

    expect(result).not.toBeNull();
    expect(result?.source).toEqual(SOURCE_P);
    expect(result?.el).toBe(parent); // drag el is the ancestor
  });

  /**
   * BUG REGRESSION: aria-hidden span where source maps ARE warm (getSourceLocation
   * returns the span's own source) should still delegate to the parent — not become
   * the drag target itself. Previously, step 1 would resolve the span directly and
   * return el=span, making a tiny emoji visually "drag" while the real intent was to
   * move the parent container.
   */
  it('skips aria-hidden element even when getSourceLocation returns a source for it', () => {
    const SOURCE_SPAN: SourceLocation = { fileName: '/src/Index.tsx', line: 307, column: 4 };
    const SOURCE_DIV: SourceLocation = { fileName: '/src/Index.tsx', line: 293, column: 6 };

    const parent = makeEl({ tagName: 'DIV' });
    const emojiSpan = makeEl({ tagName: 'SPAN', parentElement: parent }, { 'aria-hidden': 'true' });
    (parent as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };

    // Source maps are warm — both span and parent resolve, but span should be skipped
    const getSourceLocation = mock((el: HTMLElement) => {
      if (el === emojiSpan) return SOURCE_SPAN;
      if (el === parent) return SOURCE_DIV;
      return null;
    });

    const result = resolveDragSource(emojiSpan, getSourceLocation, '/src/Index.tsx');

    expect(result).not.toBeNull();
    expect(result?.source).toEqual(SOURCE_DIV); // parent's source, not the span's
    expect(result?.el).toBe(parent); // parent element dragged, not the emoji span
  });

  /**
   * BUG REGRESSION: elements with React 18 _debugSource but cold/unavailable
   * source maps should still be draggable. Previously, when getSourceLocation
   * returned null (cold source maps) and walk-up also returned null (all
   * ancestors cold), drag was silently aborted even though _debugSource was
   * available directly on the fiber.
   *
   * After the fix, resolveDragSource falls back to findNearestSourceLocation
   * which reads _debugSource directly without needing source maps.
   */
  it('falls back to _debugSource when source maps are cold (the bug scenario)', () => {
    const fiber = makeFiber({
      tag: 5,
      type: 'p',
      _debugSource: {
        fileName: '/src/HabitsTracker.tsx',
        lineNumber: 23,
        columnNumber: 5,
      },
    });

    // Attach fiber to element the same way getFiberFromDOM finds it
    const target = makeEl({ tagName: 'P' });
    // getFiberFromDOM walks __reactFiber$* keys — simulate it
    (target as unknown as Record<string, unknown>).__reactFiber$xyz = fiber;
    (target as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };

    // Source maps are cold: getSourceLocation returns null for all elements
    const getSourceLocation = mock((_el: HTMLElement) => null as SourceLocation | null);

    const result = resolveDragSource(target, getSourceLocation, '/src/HabitsTracker.tsx');

    // Without the fallback, result would be null → drag never starts. This is the bug.
    expect(result).not.toBeNull();
    expect(result?.source.fileName).toBe('/src/HabitsTracker.tsx');
    expect(result?.source.line).toBe(23);
    // column is 0-based: columnNumber 5 → column 4
    expect(result?.source.column).toBe(4);
  });

  it('returns null when no source found anywhere (truly untraceable element)', () => {
    const target = makeEl({ tagName: 'DIV' });
    (target as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };

    // No _debugSource on fiber, no source maps
    const fiber = makeFiber(); // _debugSource: null
    (target as unknown as Record<string, unknown>).__reactFiber$xyz = fiber;

    const getSourceLocation = mock((_el: HTMLElement) => null as SourceLocation | null);

    const result = resolveDragSource(target, getSourceLocation, '/src/App.tsx');

    expect(result).toBeNull();
  });

  it('prefers source-map result over _debugSource fallback when source maps are warm', () => {
    const fiber = makeFiber({
      _debugSource: {
        fileName: '/src/Wrong.tsx',
        lineNumber: 99,
        columnNumber: 1,
      },
    });
    const target = makeEl({ tagName: 'BUTTON' });
    (target as unknown as Record<string, unknown>).__reactFiber$xyz = fiber;
    (target as unknown as Record<string, unknown>).parentElement = null;

    // Source maps are warm and return a different (correct) location
    const getSourceLocation = mock((_el: HTMLElement) => SOURCE_P);

    const result = resolveDragSource(target, getSourceLocation, '/src/App.tsx');

    expect(result).not.toBeNull();
    // Should prefer getSourceLocation result, not _debugSource fallback
    expect(result?.source).toEqual(SOURCE_P);
  });
});
