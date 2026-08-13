/**
 * @file Tests for the iframe-local -> host-viewport coordinate mapping.
 *
 * Accessed via: Internal module, not exposed.
 *
 * Guards the HYP-752 app-mode regression: when the EXT address-bar row reflows
 * the iframe down, the iframe's top offset must be added to context-menu coords
 * or the menu opens a bar-height above the cursor.
 */

import { describe, expect, it } from 'bun:test';
import { type IframeOffset, iframeLocalToViewport } from './iframe-point-mapping';

describe('iframeLocalToViewport', () => {
  it('adds the iframe offset (app-mode: iframe reflowed below the address bar)', () => {
    // 48px-tall address-bar row pushes the iframe down by 48px; a 12px left gutter.
    const offset: IframeOffset = { left: 12, top: 48 };
    expect(iframeLocalToViewport(offset, 100, 200)).toEqual({ x: 112, y: 248 });
  });

  it('is identity when the iframe sits at the viewport origin (no address bar)', () => {
    const offset: IframeOffset = { left: 0, top: 0 };
    expect(iframeLocalToViewport(offset, 100, 200)).toEqual({ x: 100, y: 200 });
  });

  it('treats a null offset as the origin (iframe unavailable)', () => {
    expect(iframeLocalToViewport(null, 100, 200)).toEqual({ x: 100, y: 200 });
  });

  it('treats an undefined offset as the origin (getBoundingClientRect on a null ref)', () => {
    expect(iframeLocalToViewport(undefined, 100, 200)).toEqual({ x: 100, y: 200 });
  });

  it('reads only left/top — extra DOMRect fields are ignored', () => {
    // A real getBoundingClientRect() carries width/height/right/bottom/x/y too;
    // the mapping must depend on left/top only.
    const rectLike = { left: 5, top: 7, right: 999, bottom: 999, width: 994, height: 992, x: 5, y: 7 };
    expect(iframeLocalToViewport(rectLike, 10, 20)).toEqual({ x: 15, y: 27 });
  });

  it('preserves a click at the iframe origin (0,0 maps to the iframe top-left)', () => {
    const offset: IframeOffset = { left: 12, top: 48 };
    expect(iframeLocalToViewport(offset, 0, 0)).toEqual({ x: 12, y: 48 });
  });
});
