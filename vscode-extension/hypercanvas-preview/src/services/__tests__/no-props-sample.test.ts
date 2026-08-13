/**
 * @file Regression tests for auto-sample scaffold creation.
 */

import { describe, expect, it } from 'bun:test';
import { shouldCreateNoPropsSample } from '../no-props-sample';

describe('shouldCreateNoPropsSample', () => {
  it('returns true when no sample exists and component has no props', () => {
    expect(shouldCreateNoPropsSample({ generated: false, exists: false }, [])).toBe(true);
  });

  it('returns true when no sample exists and component has required props (try-first approach)', () => {
    // BUG-5: must attempt render without props even for components that declare props.
    // If the render fails, ComponentErrorOverlay shows — but we try first.
    expect(shouldCreateNoPropsSample({ generated: false, exists: false }, [{ name: 'title' }])).toBe(true);
  });

  it('returns false when a sample already exists', () => {
    expect(shouldCreateNoPropsSample({ generated: false, exists: true }, [])).toBe(false);
  });

  it('returns false when a sample already exists even with props', () => {
    expect(shouldCreateNoPropsSample({ generated: false, exists: true }, [{ name: 'title' }])).toBe(false);
  });

  it('returns false when component definitions are unavailable (parse failure)', () => {
    expect(shouldCreateNoPropsSample({ generated: false, exists: false }, null)).toBe(false);
  });

  it('returns false when component definitions are undefined (not yet fetched)', () => {
    expect(shouldCreateNoPropsSample({ generated: false, exists: false }, undefined)).toBe(false);
  });
});
