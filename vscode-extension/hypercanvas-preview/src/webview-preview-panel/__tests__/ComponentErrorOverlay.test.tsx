/**
 * @file Regression tests for automatic empty-sample creation in the preview error overlay.
 */

import { describe, expect, it } from 'bun:test';
import { shouldAutoCreateEmptySampleFromError } from '../ComponentErrorOverlay';

describe('ComponentErrorOverlay', () => {
  it('does not auto-create while props schema is still loading', () => {
    expect(shouldAutoCreateEmptySampleFromError(undefined, 'Error: missing sample')).toBe(false);
  });

  it('auto-creates after props schema resolves to no props', () => {
    expect(shouldAutoCreateEmptySampleFromError([], 'Error: missing sample')).toBe(true);
  });

  it('does not auto-create when the error message still points to missing props', () => {
    expect(shouldAutoCreateEmptySampleFromError([], "Cannot read properties of undefined (reading 'author')")).toBe(
      false,
    );
  });
});
