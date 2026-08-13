/**
 * @file HYP-649 — generated preview must support re-render-after-error recovery:
 *   a `hypercanvas:retryRender` listener bumps a counter that re-keys the
 *   ErrorBoundary, so a fixed component clears its stale error without a full
 *   reload. A RenderSuccessBeacon (here: the existing _ComponentSuccessSignal,
 *   posting `hypercanvas:componentRenderSucceeded`) fires when children render.
 */

import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import { generatePreviewContent, type PreviewComponentEntry } from '../generator';

const ENTRIES: PreviewComponentEntry[] = [
  {
    componentPath: 'src/components/Button.tsx',
    componentName: 'Button',
    exportStyle: 'named',
    sampleExports: ['SampleDefault'],
    importPath: './components/Button',
  },
];

describe('generated preview — error recovery (HYP-649)', () => {
  it('registers a hypercanvas:retryRender listener', () => {
    const content = generatePreviewContent(ENTRIES);
    expect(content).toContain('hypercanvas:retryRender');
  });

  it('re-keys the ErrorBoundary with a retry counter so React remounts on retry', () => {
    const content = generatePreviewContent(ENTRIES);
    // errorBoundaryKey combines componentPath + retryCount; the boundary uses it as `key`.
    expect(content).toContain('errorBoundaryKey');
    expect(content).toContain('key={errorBoundaryKey}');
  });

  it('still emits a render-success beacon (componentRenderSucceeded) for the cleared-error path', () => {
    const content = generatePreviewContent(ENTRIES);
    expect(content).toContain('hypercanvas:componentRenderSucceeded');
  });

  it('produces valid TSX with the recovery wiring', () => {
    const content = generatePreviewContent(ENTRIES);
    expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
  });
});
