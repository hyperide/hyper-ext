/**
 * @file Tests for preview webview canvas interaction message handling helpers.
 *
 * Accessed via: Hyper Canvas preview webview click/hover handling
 */

import { describe, expect, it } from 'bun:test';
import {
  computeScrollCompensationPx,
  createDragGhost,
  iframePointToViewport,
  sourceToElementId,
} from '../webview-preview-panel/useCanvasInteraction';

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

describe('iframePointToViewport', () => {
  // A fake iframe exposing only getBoundingClientRect — enough for the helper.
  const fakeFrame = (left: number, top: number) =>
    ({ getBoundingClientRect: () => ({ left, top }) }) as unknown as HTMLIFrameElement;

  it('adds the iframe offset so app-mode (iframe reflowed below the address bar) lands on the click', () => {
    // App-mode: the address-bar row pushes the iframe down by 48px. A right-click at
    // iframe-content (120, 30) must map to webview-viewport (120, 78), not (120, 30).
    expect(iframePointToViewport(fakeFrame(0, 48), 120, 30)).toEqual({ x: 120, y: 78 });
  });

  it('is an identity map when the iframe sits at the surface top (component-mode, offset 0)', () => {
    expect(iframePointToViewport(fakeFrame(0, 0), 200, 90)).toEqual({ x: 200, y: 90 });
  });

  it('also accounts for a horizontal offset (split layout / left padding)', () => {
    expect(iframePointToViewport(fakeFrame(16, 48), 100, 50)).toEqual({ x: 116, y: 98 });
  });

  it('falls back to the raw point when the iframe is null (no rect available)', () => {
    expect(iframePointToViewport(null, 42, 7)).toEqual({ x: 42, y: 7 });
  });
});

describe('computeScrollCompensationPx', () => {
  it('returns 0 when scroll has not changed since last rect computation', () => {
    expect(computeScrollCompensationPx(100, 100)).toBe(0);
  });

  it('returns negative offset when scrolled down (content moved up, overlay must follow)', () => {
    // Rects computed at scrollY=100. User scrolled to scrollY=150.
    // Overlay items now appear 50px too low — translate up by -50.
    expect(computeScrollCompensationPx(150, 100)).toBe(-50);
  });

  it('returns positive offset when scrolled up (content moved down)', () => {
    // Rects computed at scrollY=200. User scrolled back to scrollY=120.
    // Overlay items appear 80px too high — translate down by +80.
    expect(computeScrollCompensationPx(120, 200)).toBe(80);
  });

  it('handles sequence: rects@100 → scroll@110 → scroll@120 → rects@120', () => {
    // After first rect batch at baseline=100:
    const baseline = 100;
    // overlayScroll@110 → overlay should shift up by -10
    expect(computeScrollCompensationPx(110, baseline)).toBe(-10);
    // overlayScroll@120 → overlay should shift up by -20
    expect(computeScrollCompensationPx(120, baseline)).toBe(-20);
    // overlayRects arrives with baseline=120 → compensation resets to 0
    const newBaseline = 120;
    expect(computeScrollCompensationPx(120, newBaseline)).toBe(0);
  });

  it('returns 0 when both baseline and current are 0 (page top)', () => {
    expect(computeScrollCompensationPx(0, 0)).toBe(0);
  });
});
