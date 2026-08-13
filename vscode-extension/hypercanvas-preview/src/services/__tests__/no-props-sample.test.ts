/**
 * @file Regression tests for deterministic no-props SampleDefault creation.
 */

import { describe, expect, it } from 'bun:test';
import { shouldCreateNoPropsSample } from '../no-props-sample';

describe('shouldCreateNoPropsSample', () => {
  it('returns true when AI sample generation did not create a sample and props are empty', () => {
    expect(shouldCreateNoPropsSample({ generated: false, exists: false }, [])).toBe(true);
  });

  it('returns false when a sample already exists', () => {
    expect(shouldCreateNoPropsSample({ generated: false, exists: true }, [])).toBe(false);
  });

  it('returns false when props are present', () => {
    expect(shouldCreateNoPropsSample({ generated: false, exists: false }, [{ name: 'title' }])).toBe(false);
  });

  it('returns false when component definitions are unavailable', () => {
    expect(shouldCreateNoPropsSample({ generated: false, exists: false }, null)).toBe(false);
  });

  it('returns false when component definitions are undefined', () => {
    expect(shouldCreateNoPropsSample({ generated: false, exists: false }, undefined)).toBe(false);
  });
});
