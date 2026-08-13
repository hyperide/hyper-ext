/**
 * @file Tests for synthetic preview entry detection.
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import {
  type CachedFrameLocation,
  isSyntheticPreviewPath,
  selectNonSyntheticCachedLocation,
} from './synthetic-preview';
import type { SourceLocation } from './types';

describe('isSyntheticPreviewPath', () => {
  it('matches the preview entry basename regardless of directory', () => {
    expect(isSyntheticPreviewPath('src/__canvas_preview__.tsx')).toBe(true);
    expect(isSyntheticPreviewPath('apps/next/__canvas_preview__.tsx')).toBe(true);
    expect(isSyntheticPreviewPath('/abs/project/client/__canvas_preview__.tsx')).toBe(true);
  });

  it('matches the standalone preview entry', () => {
    expect(isSyntheticPreviewPath('src/__canvas_preview_standalone__.tsx')).toBe(true);
  });

  it('matches with Windows-style separators', () => {
    expect(isSyntheticPreviewPath('src\\__canvas_preview__.tsx')).toBe(true);
  });

  it('matches with a Vite HMR query string', () => {
    expect(isSyntheticPreviewPath('src/__canvas_preview__.tsx?t=1700000000000')).toBe(true);
  });

  it('does NOT match real component sources', () => {
    expect(isSyntheticPreviewPath('src/components/ChatInputBar.tsx')).toBe(false);
    expect(isSyntheticPreviewPath('src/App.tsx')).toBe(false);
    // A user file that merely contains the substring elsewhere in its path must not match.
    expect(isSyntheticPreviewPath('src/__canvas_preview__/Real.tsx')).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(isSyntheticPreviewPath(null)).toBe(false);
    expect(isSyntheticPreviewPath(undefined)).toBe(false);
    expect(isSyntheticPreviewPath('')).toBe(false);
  });
});

describe('selectNonSyntheticCachedLocation', () => {
  const real: SourceLocation = { fileName: 'src/components/ChatInputBar.tsx', line: 12, column: 4 };
  const synthetic: SourceLocation = { fileName: 'src/__canvas_preview__.tsx', line: 1, column: 0 };
  const syntheticStandalone: SourceLocation = {
    fileName: 'apps/next/__canvas_preview_standalone__.tsx',
    line: 1,
    column: 0,
  };

  // This is the regression guard for the ASYNC server-source-map fallback path
  // (RSC / React 19 pending-click). Before the synthetic-skip was made consistent
  // across resolvers, a click whose first warmed server frame collapsed back to the
  // synthetic preview entry would still resolve to __canvas_preview__.tsx via this
  // fallback — the very bug HYP-424 fixes, leaking on the RSC path. (HYP-429)

  it('skips a leading synthetic frame and returns the next real source', () => {
    const result = selectNonSyntheticCachedLocation([synthetic, real]);
    expect(result).toEqual({ found: true, value: real });
  });

  it('skips the standalone synthetic preview entry too', () => {
    const result = selectNonSyntheticCachedLocation([syntheticStandalone, real]);
    expect(result).toEqual({ found: true, value: real });
  });

  it('returns not-found when every frame is synthetic (caller walks the return chain)', () => {
    const result = selectNonSyntheticCachedLocation([synthetic, syntheticStandalone]);
    expect(result).toEqual({ found: false });
  });

  it('skips in-flight (undefined) frames and returns the next real source', () => {
    const result = selectNonSyntheticCachedLocation([undefined, real]);
    expect(result).toEqual({ found: true, value: real });
  });

  it('stops at a null (warmed-but-unresolvable) frame and returns null', () => {
    // null short-circuits so an element is not misattributed to an ancestor.
    const result = selectNonSyntheticCachedLocation([synthetic, null]);
    expect(result).toEqual({ found: true, value: null });
  });

  it('returns a real source that appears before a synthetic frame', () => {
    const result = selectNonSyntheticCachedLocation([real, synthetic]);
    expect(result).toEqual({ found: true, value: real });
  });

  it('returns not-found for an empty frame list', () => {
    expect(selectNonSyntheticCachedLocation([])).toEqual({ found: false });
  });

  it('returns not-found when all frames are still in flight', () => {
    const frames: CachedFrameLocation[] = [undefined, undefined];
    expect(selectNonSyntheticCachedLocation(frames)).toEqual({ found: false });
  });
});
