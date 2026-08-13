/**
 * @file InlineStyleWriter tests — verifies inspector-to-CSS value conversion and plan shape
 *
 * Accessed via: bun test lib/style-adapters/inline-style/writer.test.ts
 * Assumptions: cssRuntimeNormalizer is tested independently; these tests verify
 *   the writer's conversion logic and ScriptObjectStylePlan construction
 */
import { describe, expect, it } from 'bun:test';
import type { StyleSourceOwner, StyleWriteContext } from '@lib/style-write/types';
import { InlineStyleWriter } from './writer';

const writer = new InlineStyleWriter();

const baseContext: StyleWriteContext = {
  projectCapabilities: {
    projectCssSystems: ['inline-style'],
    projectUiKits: [],
    componentPropMappers: [],
    cssSyntaxes: ['css'],
    projectThemeCapabilities: { axes: [], mechanisms: [], tokenSources: [] },
    packageEvidence: [],
    configEvidence: [],
    sourceEvidence: [],
  },
  elementFacts: {
    elementCssSystems: ['inline-style'],
    elementUiKits: [],
    elementPropMappers: [],
    sourceOwners: [],
  },
  runtimeThemeContext: {
    ideThemePreference: 'light',
    resolvedColorScheme: 'light',
    source: 'test-fixture',
  },
  condition: { state: 'base' },
  requestedStyles: {},
};

const baseOwner: StyleSourceOwner = {
  cssSystem: 'inline-style',
  sourceForm: 'scriptReactStyleRule',
  filePath: 'src/App.tsx',
  elementRef: 'src/App.tsx:12:4',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
};

describe('InlineStyleWriter', () => {
  it('produces ScriptObjectStylePlan with inline-style cssSystem', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: baseOwner,
    });
    expect(plan.sourceForm).toBe('scriptReactStyleRule');
    expect(plan.cssSystem).toBe('inline-style');
  });

  it('converts inspector opacity 50 to CSS 0.5', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { opacity: '50' } },
      sourceOwner: { ...baseOwner, property: 'opacity' },
    });
    expect(plan.targetStyles.opacity).toBe('0.5');
  });

  it('converts inspector opacity 100 to CSS 1', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { opacity: '100' } },
      sourceOwner: { ...baseOwner, property: 'opacity' },
    });
    expect(plan.targetStyles.opacity).toBe('1');
  });

  it('converts inspector opacity 0 to CSS 0', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { opacity: '0' } },
      sourceOwner: { ...baseOwner, property: 'opacity' },
    });
    expect(plan.targetStyles.opacity).toBe('0');
  });

  it('converts inspector paddingLeft 16 to CSS 16px', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: baseOwner,
    });
    expect(plan.targetStyles.paddingLeft).toBe('16px');
  });

  it('preserves paddingLeft with rem units', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '1rem' } },
      sourceOwner: baseOwner,
    });
    expect(plan.targetStyles.paddingLeft).toBe('1rem');
  });

  it('passes through color values unchanged', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { backgroundColor: '#4285f4' } },
      sourceOwner: { ...baseOwner, property: 'background-color' },
    });
    expect(plan.targetStyles.backgroundColor).toBe('#4285f4');
  });

  it('passes through keyword values', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { display: 'flex' } },
      sourceOwner: { ...baseOwner, property: 'display' },
    });
    expect(plan.targetStyles.display).toBe('flex');
  });

  it('excludes empty values from targetStyles (remove)', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '' } },
      sourceOwner: baseOwner,
    });
    expect(plan.targetStyles).not.toHaveProperty('paddingLeft');
  });

  it('preserves unitless fontWeight', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { fontWeight: '700' } },
      sourceOwner: { ...baseOwner, property: 'font-weight' },
    });
    expect(plan.targetStyles.fontWeight).toBe('700');
  });

  it('sets mergeMode to object', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: baseOwner,
    });
    expect(plan.target.mergeMode).toBe('object');
  });

  it('handles multiple properties at once', () => {
    const plan = writer.createPlan({
      context: {
        ...baseContext,
        requestedStyles: { paddingLeft: '16', opacity: '50', backgroundColor: '#fff' },
      },
      sourceOwner: baseOwner,
    });
    expect(plan.targetStyles.paddingLeft).toBe('16px');
    expect(plan.targetStyles.opacity).toBe('0.5');
    expect(plan.targetStyles.backgroundColor).toBe('#fff');
  });

  it('carries sourceOwner confidence to plan', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: { ...baseOwner, confidence: 'probable' },
    });
    expect(plan.confidence).toBe('probable');
  });

  it('maps computed-only confidence to fallback', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: { ...baseOwner, confidence: 'computed-only' },
    });
    expect(plan.confidence).toBe('fallback');
  });

  it('sets target filePath from sourceOwner', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: baseOwner,
    });
    expect(plan.target.filePath).toBe('src/App.tsx');
  });

  it('sets target styles matching targetStyles', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: baseOwner,
    });
    expect(plan.target.styles).toEqual(plan.targetStyles);
  });
});
