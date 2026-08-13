/**
 * @file Tests for getSelectedElementRange — the engine-AST lookup that bridges a selection to a
 *   source range for the browser i18n read path. Covers both selection paths (AST UUID and the
 *   canvas-click nodeRef fallback) and the direct-child range collection used for descendant
 *   exclusion.
 */
import { describe, expect, mock, test } from 'bun:test';
import type { ASTNode } from '@/lib/canvas-engine/types/ast';

const getSourceByNodeRef = mock<(ref: string) => { fileName: string; line: number; column: number } | null>(() => null);
mock.module('@/lib/element-tracing/active-tracer', () => ({
  getActiveTracer: () => ({ getSourceByNodeRef }),
}));

const { getSelectedElementRange } = await import('./getSelectedElementRange');

const SPAN: ASTNode = {
  id: 'span-1',
  type: 'span',
  loc: { start: { line: 4, column: 6 }, end: { line: 4, column: 38 } },
};
const DIV: ASTNode = {
  id: 'div-1',
  type: 'div',
  loc: { start: { line: 3, column: 4 }, end: { line: 5, column: 10 } },
  children: [SPAN],
};

function makeEngine(tree: ASTNode[]) {
  return {
    getRoot: () => ({ metadata: { sampleStructure: tree }, children: [] }),
    getInstance: () => null,
  } as never;
}

describe('getSelectedElementRange', () => {
  test('returns null without engine or selection', () => {
    expect(getSelectedElementRange(null, 'div-1')).toBeNull();
    expect(getSelectedElementRange(makeEngine([DIV]), null)).toBeNull();
  });

  test('resolves by AST UUID and includes direct child ranges', () => {
    const out = getSelectedElementRange(makeEngine([DIV]), 'div-1');
    expect(out?.start).toEqual({ line: 3, column: 4 });
    expect(out?.end).toEqual({ line: 5, column: 10 });
    expect(out?.childRanges).toEqual([{ start: { line: 4, column: 6 }, end: { line: 4, column: 38 } }]);
  });

  test('a leaf element has no child ranges', () => {
    const out = getSelectedElementRange(makeEngine([DIV]), 'span-1');
    expect(out?.start).toEqual({ line: 4, column: 6 });
    expect(out?.childRanges).toEqual([]);
  });

  test('falls back to the tracer nodeRef → source loc → AST node (canvas-click path)', () => {
    getSourceByNodeRef.mockClear();
    // selectedId is a nodeRef the engine does not know as a UUID; the tracer maps it to the span loc.
    getSourceByNodeRef.mockReturnValueOnce({ fileName: 'src/Hero.tsx', line: 4, column: 6 });
    const out = getSelectedElementRange(makeEngine([DIV]), 'noderef:src/Hero.tsx:7');
    expect(getSourceByNodeRef).toHaveBeenCalledWith('noderef:src/Hero.tsx:7');
    expect(out?.start).toEqual({ line: 4, column: 6 });
  });

  test('returns null when neither UUID nor nodeRef resolves', () => {
    getSourceByNodeRef.mockReturnValueOnce(null);
    expect(getSelectedElementRange(makeEngine([DIV]), 'unknown-id')).toBeNull();
  });
});
