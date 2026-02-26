import { describe, expect, it } from 'bun:test';
import { buildDesignStylesCSS } from './style-injector';

describe('buildDesignStylesCSS', () => {
  it('includes cursor override in design mode', () => {
    const css = buildDesignStylesCSS({ mode: 'design' });
    expect(css).toContain('cursor: default !important');
  });

  it('includes empty container styles when mode is design', () => {
    const css = buildDesignStylesCSS({ mode: 'design' });
    expect(css).toContain('min-height: 120px');
    expect(css).toContain('border: 2px dashed');
  });

  it('includes ::after content for empty containers', () => {
    const css = buildDesignStylesCSS({ mode: 'design' });
    expect(css).toContain("content: 'Drop elements here'");
  });

  it('omits empty container styles in interact mode', () => {
    const css = buildDesignStylesCSS({ mode: 'interact' });
    expect(css).not.toContain('min-height: 120px');
    expect(css).not.toContain("content: 'Drop elements here'");
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
