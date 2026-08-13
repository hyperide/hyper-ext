/**
 * @file Unit tests for the D3 stylability ladder resolver (L0 / L1 / L2 / L3)
 *
 * Accessed via: multi-select batch write planning — resolves each element/property to a write rung.
 * Architecture: docs/specs/2026-06-11-270-d3-stylability-ladder.md §3
 */

import { describe, expect, it } from 'bun:test';
import type { ComponentPropSurfaceFacts, InspectorSurfaceDecision } from '@lib/style-read/types';
import { resolveStyleSurface } from './stylability-ladder';

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
