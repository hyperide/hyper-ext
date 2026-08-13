import { describe, expect, it } from 'bun:test';
import { buildDesignStylesCSS } from './style-injector';

describe('buildDesignStylesCSS', () => {
  it('includes cursor override in design mode', () => {
    const css = buildDesignStylesCSS({ mode: 'design' });
    expect(css).toContain('cursor: default !important');
  });

  it('does not inject min-height for empty containers (overlays handle visibility)', () => {
    const css = buildDesignStylesCSS({ mode: 'design' });
    expect(css).not.toContain('hc-empty');
    expect(css).not.toContain('min-height');
  });

  it('handles board mode (pointer-events on body)', () => {
    const css = buildDesignStylesCSS({
      mode: 'design',
      boardModeActive: true,
      transparentBackground: true,
    });
    expect(css).toContain('pointer-events: none !important');
    expect(css).toContain('pointer-events: auto !important');
  });

  it('handles transparent background option', () => {
    const css = buildDesignStylesCSS({
      mode: 'design',
      transparentBackground: true,
    });
    expect(css).toContain('background: transparent !important');
  });

  it('handles multi canvas mode with overflow hidden', () => {
    const css = buildDesignStylesCSS({
      mode: 'design',
      transparentBackground: true,
      canvasMode: 'multi',
    });
    expect(css).toContain('overflow: hidden !important');
  });

  it('returns a non-empty string', () => {
    const css = buildDesignStylesCSS({ mode: 'design' });
    expect(css.length).toBeGreaterThan(0);
  });
});
