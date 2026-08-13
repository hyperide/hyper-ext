/**
 * @file Inspector header label resolution tests (VS Code mode).
 *
 * Accessed via: bun test client/components/RightSidebar/__tests__/inspector-frame-label.test.ts
 *
 * Guards the string shown at the TOP of the inspector for the selected element. The
 * style-read RPC reports `tagType: 'unknown'` as a SENTINEL whenever the host could not
 * resolve the element to a source JSX tag (selection lost after HMR, a bundle artifact,
 * a parse/IO error, or an RPC transport failure — StyleReadService returns its `empty`
 * result and useElementStyleData maps a failed RPC to the same sentinel). Leaking that
 * raw lowercase token into the header reads as a bug to the user (tg#5071). The label
 * must collapse the sentinel to the generic fallback the header already intends.
 */

import { describe, expect, test } from 'bun:test';
import { resolveVSCodeFrameLabel } from '../utils';

describe('resolveVSCodeFrameLabel', () => {
  test('the unresolved "unknown" sentinel does NOT leak — shows the generic fallback', () => {
    // Regression for tg#5071: the inspector header showed the raw lowercase "unknown"
    // token. The sentinel is truthy, so the original `tagType || 'Frame'` fallback never
    // fired. The unresolved case must show the generic label, never the debug token.
    expect(resolveVSCodeFrameLabel('unknown')).not.toBe('unknown');
    expect(resolveVSCodeFrameLabel('unknown')).toBe('Frame');
  });

  test('an empty / missing tag type shows the generic fallback', () => {
    expect(resolveVSCodeFrameLabel('')).toBe('Frame');
    expect(resolveVSCodeFrameLabel(undefined)).toBe('Frame');
  });

  test('a host element div is labelled "Frame (div)"', () => {
    expect(resolveVSCodeFrameLabel('div')).toBe('Frame (div)');
  });

  test('a resolved component name is returned verbatim', () => {
    // After #557 (cross-package @fs/ strip), a cross-package <Button> resolves to its real
    // tag — that real name must pass through untouched, NOT be collapsed to the fallback.
    expect(resolveVSCodeFrameLabel('Button')).toBe('Button');
    expect(resolveVSCodeFrameLabel('NavBar')).toBe('NavBar');
  });

  test('a resolved intrinsic (non-div) host element is returned verbatim', () => {
    expect(resolveVSCodeFrameLabel('span')).toBe('span');
    expect(resolveVSCodeFrameLabel('svg')).toBe('svg');
  });
});
