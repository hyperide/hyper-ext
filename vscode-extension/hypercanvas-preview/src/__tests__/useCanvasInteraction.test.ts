/**
 * @file Tests for preview webview canvas interaction message handling helpers.
 *
 * Accessed via: Hyper Canvas preview webview click/hover handling
 */

import { describe, expect, it } from 'bun:test';
import { createDragGhost, sourceToElementId } from '../webview-preview-panel/useCanvasInteraction';

describe('createDragGhost', () => {
  it('creates a fixed full-viewport div for width axis with ew-resize cursor', () => {
    const ghost = createDragGhost('width');
    expect(ghost.tagName).toBe('DIV');
    expect(ghost.style.position).toBe('fixed');
    expect(ghost.style.top).toBe('0px');
    expect(ghost.style.left).toBe('0px');
    expect(ghost.style.right).toBe('0px');
    expect(ghost.style.bottom).toBe('0px');
    expect(ghost.style.pointerEvents).toBe('all');
    expect(ghost.style.cursor).toBe('ew-resize');
    expect(ghost.style.touchAction).toBe('none');
    expect(ghost.style.userSelect).toBe('none');
  });

  it('creates a ns-resize cursor for height axis', () => {
    const ghost = createDragGhost('height');
    expect(ghost.style.cursor).toBe('ns-resize');
  });
});

describe('sourceToElementId', () => {
  it('builds the same synthetic element id used by iframe source fallback clicks', () => {
    expect(sourceToElementId({ fileName: 'src/components/Card.tsx', line: 12, column: 4 })).toBe(
      'src/components/Card.tsx:12:4',
    );
  });

  it('rejects malformed source payloads', () => {
    expect(sourceToElementId(null)).toBeNull();
    expect(sourceToElementId({ fileName: 'src/components/Card.tsx', line: 12 })).toBeNull();
  });
});
