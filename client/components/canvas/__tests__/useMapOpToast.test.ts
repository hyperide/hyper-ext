/**
 * useMapOpToast pure-helper tests (HYP-290c / HYP-290h).
 *
 * The sample-path derivation and the bare-receiver gate decide whether the DOM toggle
 * is offered (the server re-validates the category; these are the cheap client guards).
 *
 * HYP-290h: `resolveMapOpRoute` is the classifier-driven router. It replaces the
 * syntax-only `isBareMapReceiver` gate so a literal-array source routes to the literal
 * op (not the sample op), and a hook-derived / generator source DISABLES the DOM toggle
 * (the destructive JSX-redo fallthrough is never reached for an unsupported source).
 */

import { describe, expect, it } from 'bun:test';
import { deriveSampleFilePath, isBareMapReceiver, resolveMapOpRoute } from '../useMapOpToast';

describe('deriveSampleFilePath (HYP-290c)', () => {
  it('maps a component file to its colocated *.samples.tsx', () => {
    expect(deriveSampleFilePath('/app/src/List.tsx')).toBe('/app/src/List.samples.tsx');
  });

  it('preserves the original extension family (jsx/ts/js)', () => {
    expect(deriveSampleFilePath('/app/List.jsx')).toBe('/app/List.samples.jsx');
    expect(deriveSampleFilePath('/app/List.ts')).toBe('/app/List.samples.ts');
  });

  it('only rewrites the trailing extension, not earlier dots in the path', () => {
    expect(deriveSampleFilePath('/app/my.feature/List.tsx')).toBe('/app/my.feature/List.samples.tsx');
  });
});

describe('isBareMapReceiver (HYP-290c)', () => {
  it('accepts a bare identifier (category-1 eligible)', () => {
    expect(isBareMapReceiver('items')).toBe(true);
    expect(isBareMapReceiver('  users  ')).toBe(true);
    expect(isBareMapReceiver('_data$1')).toBe(true);
  });

  it('rejects member / destructure receivers (deferred — DOM toggle disabled)', () => {
    expect(isBareMapReceiver('props.items')).toBe(false);
    expect(isBareMapReceiver('data.users')).toBe(false);
    expect(isBareMapReceiver('items.filter(Boolean)')).toBe(false);
    expect(isBareMapReceiver('')).toBe(false);
  });
});

describe('resolveMapOpRoute (HYP-290h — classifier-driven routing)', () => {
  const base = {
    componentFilePath: '/app/src/List.tsx',
    sampleFilePath: '/app/src/List.tsx', // inline sample lives in the component file (live path)
    sampleName: 'SampleDefault',
    mapExpression: 'items',
    itemIndex: 1,
    operation: 'delete' as const,
  };

  it('props-from-sample → enables DOM, routes to the SAMPLE op against the resolved sample file', () => {
    const route = resolveMapOpRoute({ ...base, category: 'props-from-sample' });

    expect(route.domEnabled).toBe(true);
    expect(route.dispatch).toBe('sample');
    expect(route.sampleParams).not.toBeNull();
    // Requirement #2: the sample file is the resolved active sample path, NOT a hardcoded
    // sibling *.samples.tsx — for the live (inline-sample) path it equals the component file.
    expect(route.sampleParams?.filePath).toBe('/app/src/List.tsx');
    expect(route.sampleParams?.componentFilePath).toBe('/app/src/List.tsx');
    expect(route.literalParams).toBeNull();
  });

  it('props-from-sample → falls back to the derived sibling sample path when none is resolved', () => {
    const route = resolveMapOpRoute({ ...base, sampleFilePath: null, category: 'props-from-sample' });

    expect(route.domEnabled).toBe(true);
    expect(route.dispatch).toBe('sample');
    expect(route.sampleParams?.filePath).toBe('/app/src/List.samples.tsx');
  });

  it('literal-array → enables DOM, routes to the LITERAL op against the component file (NOT the sample op)', () => {
    const route = resolveMapOpRoute({ ...base, category: 'literal-array' });

    expect(route.domEnabled).toBe(true);
    expect(route.dispatch).toBe('literal');
    expect(route.literalParams).not.toBeNull();
    expect(route.literalParams?.componentFilePath).toBe('/app/src/List.tsx');
    // The destructive misroute the P2 fixes: a literal source must NOT build sample params.
    expect(route.sampleParams).toBeNull();
  });

  it('hook-derived → DISABLES the DOM toggle (no destructive JSX-redo fallthrough)', () => {
    const route = resolveMapOpRoute({ ...base, mapExpression: 'rows', category: 'hook-derived' });

    expect(route.domEnabled).toBe(false);
    expect(route.dispatch).toBe(null);
    expect(route.sampleParams).toBeNull();
    expect(route.literalParams).toBeNull();
  });

  it('generator → DISABLES the DOM toggle (unsupported data source)', () => {
    const route = resolveMapOpRoute({ ...base, mapExpression: 'buildList()', category: 'generator' });

    expect(route.domEnabled).toBe(false);
    expect(route.dispatch).toBe(null);
  });

  it('unknown / missing category → DISABLES the DOM toggle (no classification, no guess)', () => {
    const route = resolveMapOpRoute({ ...base, category: undefined });

    expect(route.domEnabled).toBe(false);
    expect(route.dispatch).toBe(null);
  });
});
