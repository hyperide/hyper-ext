/**
 * Unit tests for pure helpers exported from usePreviewBridge.
 */

import { describe, expect, it } from 'bun:test';
import type { ComponentError } from '../usePreviewBridge';
import { applyComponentRenderSucceeded } from '../usePreviewBridge';

const makeError = (componentPath: string, errorSeq = 1): ComponentError => ({
  componentPath,
  error: 'Test error',
  errorSeq,
});

describe('applyComponentRenderSucceeded', () => {
  it('clears error when componentPath matches', () => {
    const err = makeError('src/components/Menubar.tsx');
    expect(applyComponentRenderSucceeded(err, 'src/components/Menubar.tsx')).toBeNull();
  });

  it('keeps error when componentPath does not match', () => {
    const err = makeError('src/components/Menubar.tsx');
    const result = applyComponentRenderSucceeded(err, 'src/components/Button.tsx');
    expect(result).toBe(err);
  });

  it('returns null when prev is already null', () => {
    expect(applyComponentRenderSucceeded(null, 'src/components/Menubar.tsx')).toBeNull();
  });
});
