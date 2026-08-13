/**
 * @file Regression tests for in-memory generated-prop injection gating (#210).
 */

import { describe, expect, it } from 'bun:test';
import { shouldInjectGeneratedProps } from '../no-props-sample';

describe('shouldInjectGeneratedProps', () => {
  it('returns true when no sample exists and component has no props', () => {
    expect(shouldInjectGeneratedProps({ generated: false, exists: false }, [])).toBe(true);
  });

  it('returns true when no sample exists and component has required props (try-first approach)', () => {
    // Must attempt render with generated props even for components that declare props.
    // If the render fails, ComponentErrorOverlay shows — but we try first.
    expect(shouldInjectGeneratedProps({ generated: false, exists: false }, [{ name: 'title' }])).toBe(true);
  });

  it('returns false when a sample already exists', () => {
    // Authored SampleDefault wins in the generator — no point computing/posting props.
    expect(shouldInjectGeneratedProps({ generated: false, exists: true }, [])).toBe(false);
  });

  it('returns false when a sample already exists even with props', () => {
    expect(shouldInjectGeneratedProps({ generated: false, exists: true }, [{ name: 'title' }])).toBe(false);
  });

  it('returns false when component definitions are unavailable (parse failure)', () => {
    expect(shouldInjectGeneratedProps({ generated: false, exists: false }, null)).toBe(false);
  });

  it('returns false when component definitions are undefined (not yet fetched)', () => {
    expect(shouldInjectGeneratedProps({ generated: false, exists: false }, undefined)).toBe(false);
  });

  it('is independent of the autoSampleGeneration setting (in-memory never writes source)', () => {
    // The old source-mutation gate read hypercanvas.preview.autoSampleGeneration.
    // In-memory injection must work regardless — assert no vscode dependency by
    // exercising the function with no vscode mock present.
    expect(shouldInjectGeneratedProps({ generated: false, exists: false }, [{ name: 'tweet' }])).toBe(true);
  });
});
