/**
 * @file Unit tests for the D3 stylability ladder resolver (L0 / L1 / L2 / L3)
 *
 * Accessed via: multi-select batch write planning — resolves each element/property to a write rung.
 * Architecture: docs/specs/2026-06-11-270-d3-stylability-ladder.md §3
 */

import { describe, expect, it } from 'bun:test';
import type { ComponentPropSurfaceFacts, InspectorSurfaceDecision } from '@lib/style-read/types';
import { hasNoStyleWriteSurface, resolveStyleSurface } from './stylability-ladder';

function surface(
  partial: Partial<InspectorSurfaceDecision> & Pick<InspectorSurfaceDecision, 'reasons'>,
): InspectorSurfaceDecision {
  return {
    standardStyleInspector: partial.standardStyleInspector ?? 'enabled',
    propsEditor: partial.propsEditor ?? 'hidden',
    reasons: partial.reasons,
  };
}

function facts(partial: Partial<ComponentPropSurfaceFacts> = {}): ComponentPropSurfaceFacts {
  return {
    acceptsClassName: false,
    acceptsStyle: false,
    acceptsCssProp: false,
    acceptsSxProp: false,
    recursivePropsSchemaAvailable: false,
    styleLikeProps: [],
    semanticProps: [],
    ...partial,
  };
}

describe('resolveStyleSurface', () => {
  it('L0 when surfaceDecision declares an adapter-known prop mapper', () => {
    const r = resolveStyleSurface(surface({ reasons: ['adapter-known-prop-mapper'] }), facts(), 'padding');
    expect(r.rung).toBe('L0');
    expect(r.channel).toBe('props');
  });

  it('L1 when the element accepts a generic className channel', () => {
    const r = resolveStyleSurface(
      surface({ reasons: ['accepts-className'] }),
      facts({ acceptsClassName: true }),
      'color',
    );
    expect(r.rung).toBe('L1');
    expect(r.channel).toBe('styles');
  });

  it('L1 for an intrinsic element via accepts-style', () => {
    const r = resolveStyleSurface(
      surface({ reasons: ['intrinsic-element', 'accepts-style'] }),
      facts({ acceptsStyle: true }),
      'color',
    );
    expect(r.rung).toBe('L1');
    expect(r.channel).toBe('styles');
  });

  it('L2 when only a partial style prop covers THIS property', () => {
    const r = resolveStyleSurface(
      surface({ reasons: ['props-schema-available'] }),
      facts({ styleLikeProps: ['padding'], semanticProps: ['variant'] }),
      'padding',
    );
    expect(r.rung).toBe('L2');
    expect(r.channel).toBe('props');
  });

  it('L3 when the partial prop set does NOT cover this property', () => {
    const r = resolveStyleSurface(
      surface({ reasons: ['props-schema-available'] }),
      facts({ styleLikeProps: ['padding'] }),
      'boxShadow',
    );
    expect(r.rung).toBe('L3');
  });

  it('L3 when no surface at all', () => {
    const r = resolveStyleSurface(surface({ reasons: ['no-standard-style-surface'] }), facts(), 'color');
    expect(r.rung).toBe('L3');
  });

  it('L0 wins over a style channel when both are present (DS-native prop preferred)', () => {
    const r = resolveStyleSurface(
      surface({ reasons: ['adapter-known-prop-mapper', 'accepts-className'] }),
      facts({ acceptsClassName: true }),
      'padding',
    );
    expect(r.rung).toBe('L0');
  });

  it('a property covered by semanticProps resolves L2', () => {
    const r = resolveStyleSurface(
      surface({ reasons: ['props-schema-available'] }),
      facts({ semanticProps: ['gap'] }),
      'gap',
    );
    expect(r.rung).toBe('L2');
  });
});

// HYP-1294 — the proactive, host-agnostic "no channel at all" predicate the SaaS inspector reads
// straight off `ComponentPropSurfaceFacts` (no `InspectorSurfaceDecision` required — browser mode
// has none, HYP-664).
describe('hasNoStyleWriteSurface', () => {
  it('true when every channel is false and no partial-prop cover exists (the A1 full-exclusion shape)', () => {
    expect(hasNoStyleWriteSurface(facts())).toBe(true);
  });

  it('false when acceptsClassName is the only true channel', () => {
    expect(hasNoStyleWriteSurface(facts({ acceptsClassName: true }))).toBe(false);
  });

  it('false when acceptsStyle is the only true channel', () => {
    expect(hasNoStyleWriteSurface(facts({ acceptsStyle: true }))).toBe(false);
  });

  it('false when acceptsCssProp or acceptsSxProp is true (future adapter-facts sources)', () => {
    expect(hasNoStyleWriteSurface(facts({ acceptsCssProp: true }))).toBe(false);
    expect(hasNoStyleWriteSurface(facts({ acceptsSxProp: true }))).toBe(false);
  });

  it('false when a partial prop cover exists even though no generic channel does', () => {
    expect(hasNoStyleWriteSurface(facts({ styleLikeProps: ['padding'] }))).toBe(false);
    expect(hasNoStyleWriteSurface(facts({ semanticProps: ['gap'] }))).toBe(false);
  });

  // acceptsAnyStyleChannel (the four-channel-boolean check) stays MODULE-PRIVATE — it has no
  // production consumer of its own outside this predicate (review finding, HYP-1294: exporting it
  // only for a test invites a second, weaker "can we style this" predicate to accumulate call
  // sites alongside this one). Its per-channel behavior is exercised here transitively instead.
  it('false is returned per-channel: each of the four booleans alone still yields true (no early positive)', () => {
    expect(hasNoStyleWriteSurface(facts({ acceptsClassName: true }))).toBe(false);
    expect(hasNoStyleWriteSurface(facts({ acceptsStyle: true }))).toBe(false);
    expect(hasNoStyleWriteSurface(facts({ acceptsCssProp: true }))).toBe(false);
    expect(hasNoStyleWriteSurface(facts({ acceptsSxProp: true }))).toBe(false);
  });
});
