/**
 * @file Tests for the canonical skip/result reason labels and the D2 cascade "where it landed" labels
 *
 * Accessed via: bun test lib/style-write/skip-reason-codes.test.ts
 * Assumptions: this is the single source of truth for skip reasons (D2 §4.4 / D3 §5.3) and the
 *   cascade-fallback badge labels (CTO 2026-06-11).
 */
import { describe, expect, it } from 'bun:test';
import { describeLandedReason, describeLandedSystem, describeSkipReason } from './skip-reason-codes';

describe('describeSkipReason', () => {
  it('STALE_SOURCE is a safety skip, not a "where to write" skip (CTO 2026-06-11)', () => {
    expect(describeSkipReason('STALE_SOURCE')).toContain('selection changed');
  });
});

describe('describeLandedSystem / describeLandedReason — D2 cascade badge (CTO 2026-06-11)', () => {
  it('renders the CTO marquee example: an inexpressible property landed inline', () => {
    // "shadow → inline (outside the system's scale)" — the badge surfaces the silent-inline hazard.
    const label = `box-shadow → ${describeLandedSystem('inline-style')}${describeLandedReason('inexpressible')}`;
    expect(label).toBe("box-shadow → inline (outside the system's scale)");
  });

  it('labels each fallback system in human terms', () => {
    expect(describeLandedSystem('inline-style')).toBe('inline');
    expect(describeLandedSystem('tailwind-v4')).toBe('Tailwind');
    expect(describeLandedSystem('css-modules')).toBe('CSS Module');
  });

  it('appends a project-default clause when a surfaceless element floored to the project system', () => {
    expect(describeLandedReason('project-default')).toContain('project default');
    expect(describeLandedReason('project-system')).toContain('project default');
  });

  it('adds no clause for an unknown reason', () => {
    expect(describeLandedReason('something-else')).toBe('');
  });
});
