/**
 * @file Preview bridge URL helper tests
 *
 * Accessed via: Hyper Canvas preview webview when switching the selected component
 * Assumptions: an iframe at about:blank has not loaded the preview app and must be navigated.
 * Past bugs: HYP-363 — updateUrl was sent as postMessage into about:blank, leaving preview empty.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it } from 'bun:test';
import {
  buildComponentPreviewUrl,
  getComponentFromPreviewUrl,
  hasNavigatedPreviewSource,
  shouldNavigateFrameToComponent,
} from '../webview-preview-panel/usePreviewBridge';

describe('preview bridge URL helpers', () => {
  it('builds component preview URL with encoded component path', () => {
    expect(buildComponentPreviewUrl('http://localhost:5173/', 'src/components/Foo Bar.tsx')).toBe(
      'http://localhost:5173/test-preview?component=src%2Fcomponents%2FFoo%20Bar.tsx',
    );
  });

  it('treats about:blank as not navigated', () => {
    expect(hasNavigatedPreviewSource('about:blank')).toBe(false);
    expect(hasNavigatedPreviewSource('')).toBe(false);
    expect(hasNavigatedPreviewSource(null)).toBe(false);
    expect(hasNavigatedPreviewSource('http://localhost:5173/test-preview?component=src%2FApp.tsx')).toBe(true);
  });

  it('reads the current iframe component from preview URL', () => {
    expect(getComponentFromPreviewUrl('http://localhost:5173/test-preview')).toBe(null);
    expect(getComponentFromPreviewUrl('about:blank')).toBe(null);
    expect(getComponentFromPreviewUrl('not a url')).toBe(null);
    expect(getComponentFromPreviewUrl('http://localhost:5173/test-preview?component=src%2FApp.tsx')).toBe(
      'src/App.tsx',
    );
  });

  it('requires navigation when the frame loaded a bare preview route', () => {
    expect(shouldNavigateFrameToComponent('http://localhost:5173/test-preview', 'src/App.tsx')).toBe(true);
    expect(
      shouldNavigateFrameToComponent('http://localhost:5173/test-preview?component=src%2FOther.tsx', 'src/App.tsx'),
    ).toBe(true);
    expect(
      shouldNavigateFrameToComponent('http://localhost:5173/test-preview?component=src%2FApp.tsx', 'src/App.tsx'),
    ).toBe(false);
  });
});
