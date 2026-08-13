/**
 * @file CssModulesWriter tests — verifies inspector-to-CSS value conversion and plan shape
 *
 * Accessed via: bun test lib/style-adapters/css-modules/writer.test.ts
 * Assumptions: cssRuntimeNormalizer is tested independently; these tests verify
 *   the writer's conversion logic and CssModulesFilePlan construction
 */
import { describe, expect, it } from 'bun:test';
import type { CssModulesFilePlan, StyleSourceOwner, StyleWriteContext } from '@lib/style-write/types';
import { CssModulesWriter } from './writer';

const writer = new CssModulesWriter();

const baseContext: StyleWriteContext = {
  projectCapabilities: {
    projectCssSystems: ['css-modules'],
    projectUiKits: [],
    componentPropMappers: [],
    cssSyntaxes: ['css'],
    projectThemeCapabilities: { axes: [], mechanisms: [], tokenSources: [] },
    packageEvidence: [],
    configEvidence: [],
    sourceEvidence: [],
  },
  elementFacts: {
    elementCssSystems: ['css-modules'],
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
  cssSystem: 'css-modules',
  sourceForm: 'cssStyleRule',
  cssSyntax: 'css',
  filePath: 'src/Card.module.css',
  selector: '.card',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
};

describe('CssModulesWriter', () => {
  it('produces CssModulesFilePlan with cssStyleRule sourceForm', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: baseOwner,
    });
    expect(plan.sourceForm).toBe('cssStyleRule');
    expect(plan.cssSystem).toBe('css-modules');
  });

  it('converts inspector paddingLeft 16 to CSS declaration padding-left: 16px', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: baseOwner,
    }) as CssModulesFilePlan;
    expect(plan.target.declarations['padding-left']).toBe('16px');
  });

  it('converts inspector opacity 50 to CSS declaration opacity: 0.5', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { opacity: '50' } },
      sourceOwner: { ...baseOwner, property: 'opacity' },
    }) as CssModulesFilePlan;
    expect(plan.target.declarations.opacity).toBe('0.5');
  });

  it('passes through color values', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { backgroundColor: '#4285f4' } },
      sourceOwner: { ...baseOwner, property: 'background-color' },
    }) as CssModulesFilePlan;
    expect(plan.target.declarations['background-color']).toBe('#4285f4');
  });

  it('excludes empty values from declarations', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '' } },
      sourceOwner: baseOwner,
    }) as CssModulesFilePlan;
    expect(plan.target.declarations['padding-left']).toBeUndefined();
  });

  it('carries selector from sourceOwner', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: { ...baseOwner, selector: '.featured' },
    }) as CssModulesFilePlan;
    expect(plan.target.selector).toBe('.featured');
  });

  it('derives classKey by stripping leading dot from selector', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: { ...baseOwner, selector: '.card' },
    }) as CssModulesFilePlan;
    expect(plan.target.classKey).toBe('card');
  });

  it('carries cssSyntax from sourceOwner', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: { ...baseOwner, cssSyntax: 'scss' },
    }) as CssModulesFilePlan;
    expect(plan.target.cssSyntax).toBe('scss');
  });

  it('handles multiple declarations', () => {
    const plan = writer.createPlan({
      context: {
        ...baseContext,
        requestedStyles: { paddingLeft: '16', paddingRight: '24', opacity: '80' },
      },
      sourceOwner: baseOwner,
    }) as CssModulesFilePlan;
    expect(plan.target.declarations['padding-left']).toBe('16px');
    expect(plan.target.declarations['padding-right']).toBe('24px');
    expect(plan.target.declarations.opacity).toBe('0.8');
  });

  it('maps computed-only confidence to fallback', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: { ...baseOwner, confidence: 'computed-only' },
    });
    expect(plan.confidence).toBe('fallback');
  });

  it('sets cssFilePath from sourceOwner filePath', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: { ...baseOwner, filePath: 'src/Card.module.scss' },
    }) as CssModulesFilePlan;
    expect(plan.target.cssFilePath).toBe('src/Card.module.scss');
  });
});
