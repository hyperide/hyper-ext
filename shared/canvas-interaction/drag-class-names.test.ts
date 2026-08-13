/**
 * @file Tests for stripTransientDragClasses (drag-class-names.ts).
 *
 * Guards the order-class reorder path against persisting transient drag-overlay
 * classes into the user's JSX. The drag script adds DRAG_SOURCE_CLASS to the live
 * dragged element for the duration of the gesture; resolveOrderWritePlan reads the
 * live className and writes it back to source, so the transient class MUST be
 * stripped first — otherwise `.hyper-drag-source { pointer-events:none }` would be
 * baked in and permanently disable the element (review: Codex High finding).
 */
import { describe, expect, test } from 'bun:test';

import {
  DRAG_BADGE_CLASS,
  DRAG_GHOST_CLASS,
  DRAG_SOURCE_CLASS,
  DROP_INDICATOR_CLASS,
  stripTransientDragClasses,
} from './drag-class-names';

describe('stripTransientDragClasses', () => {
  test('removes DRAG_SOURCE_CLASS while preserving user + order classes', () => {
    const result = stripTransientDragClasses(`px-2 py-1 ${DRAG_SOURCE_CLASS} order-2 bg-blue`);
    expect(result).toBe('px-2 py-1 order-2 bg-blue');
    expect(result).not.toContain(DRAG_SOURCE_CLASS);
  });

  test('removes every transient overlay class', () => {
    const result = stripTransientDragClasses(
      `keep-1 ${DRAG_SOURCE_CLASS} ${DRAG_GHOST_CLASS} ${DROP_INDICATOR_CLASS} ${DRAG_BADGE_CLASS} keep-2`,
    );
    expect(result).toBe('keep-1 keep-2');
  });

  test('leaves a className with no transient classes byte-identical (modulo whitespace)', () => {
    expect(stripTransientDragClasses('px-2 py-1 order-3')).toBe('px-2 py-1 order-3');
  });

  test('collapses extra whitespace and handles an empty string', () => {
    expect(stripTransientDragClasses('')).toBe('');
    expect(stripTransientDragClasses(`   ${DRAG_SOURCE_CLASS}   `)).toBe('');
    expect(stripTransientDragClasses(`a   ${DRAG_SOURCE_CLASS}   b`)).toBe('a b');
  });

  test('does not strip a class that merely CONTAINS a transient token as a substring', () => {
    // `hyper-drag-source-x` is a different token and must survive.
    const result = stripTransientDragClasses(`${DRAG_SOURCE_CLASS}-x other`);
    expect(result).toBe(`${DRAG_SOURCE_CLASS}-x other`);
  });
});
