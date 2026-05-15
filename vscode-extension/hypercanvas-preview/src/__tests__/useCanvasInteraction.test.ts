/**
 * @file Tests for preview webview canvas interaction message handling helpers.
 *
 * Accessed via: Hyper Canvas preview webview click/hover handling
 */

import { describe, expect, it } from 'bun:test';
import { sourceToElementId } from '../webview-preview-panel/useCanvasInteraction';

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
