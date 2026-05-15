import { describe, expect, it } from 'bun:test';
import type { StyleSourceOwner, StyleWriteContext } from '@lib/style-write/types';
import { TailwindV4Writer } from './writer';

const writer = new TailwindV4Writer();

const baseContext: StyleWriteContext = {
  projectCapabilities: {
    projectCssSystems: ['tailwind-v4'],
    projectUiKits: [],
    componentPropMappers: [],
    cssSyntaxes: ['css'],
    projectThemeCapabilities: { axes: [], mechanisms: [], tokenSources: [] },
    packageEvidence: [],
    configEvidence: [],
    sourceEvidence: [],
  },
  elementFacts: {
    elementCssSystems: ['tailwind-v4'],
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
  cssSystem: 'tailwind-v4',
  sourceForm: 'elementClass',
  filePath: 'src/App.tsx',
  elementRef: 'src/App.tsx:12:4',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
};

describe('TailwindV4Writer', () => {
  it('produces TailwindPlan with static strategy', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: baseOwner,
    });
    expect(plan.sourceForm).toBe('elementClass');
    expect(plan.cssSystem).toBe('tailwind-v4');
    expect(plan.strategy.mode).toBe('static');
    // generateTailwindClasses should produce pl-[16px] for paddingLeft: '16'
    expect(plan.strategy.addClasses).toContain('pl-');
    expect(plan.strategy.removeForProperties).toContain('paddingLeft');
  });

  it('generates opacity class from inspector value', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { opacity: '50' } },
      sourceOwner: { ...baseOwner, property: 'opacity' },
    });
    expect(plan.strategy.addClasses).toContain('opacity-50');
  });

  it('generates bg class from hex color', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { backgroundColor: '#ef4444' } },
      sourceOwner: { ...baseOwner, property: 'background-color' },
    });
    expect(plan.strategy.addClasses).toContain('bg-');
  });

  it('adds hover: prefix for hover state', () => {
    const plan = writer.createPlan({
      context: {
        ...baseContext,
        condition: { state: 'hover' },
        requestedStyles: { opacity: '80' },
      },
      sourceOwner: { ...baseOwner, property: 'opacity', condition: { state: 'hover' } },
    });
    expect(plan.strategy.addClasses).toContain('hover:');
    expect(plan.condition.state).toBe('hover');
  });

  it('adds focus: prefix for focus state', () => {
    const plan = writer.createPlan({
      context: {
        ...baseContext,
        condition: { state: 'focus' },
        requestedStyles: { opacity: '80' },
      },
      sourceOwner: { ...baseOwner, property: 'opacity', condition: { state: 'focus' } },
    });
    expect(plan.strategy.addClasses).toContain('focus:');
  });

  it('collects all requestedStyles keys in removeForProperties', () => {
    const plan = writer.createPlan({
      context: {
        ...baseContext,
        requestedStyles: { paddingLeft: '16', paddingRight: '16' },
      },
      sourceOwner: baseOwner,
    });
    expect(plan.strategy.removeForProperties).toContain('paddingLeft');
    expect(plan.strategy.removeForProperties).toContain('paddingRight');
  });

  it('produces empty addClasses for empty value (remove property)', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '' } },
      sourceOwner: baseOwner,
    });
    expect(plan.strategy.addClasses).toBe('');
    expect(plan.strategy.removeForProperties).toContain('paddingLeft');
  });

  it('excludes empty values from class generation in mixed updates', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { shadow: '', paddingLeft: '16' } },
      sourceOwner: baseOwner,
    });
    // shadow='' should NOT produce a shadow class, only paddingLeft should generate
    expect(plan.strategy.addClasses).toContain('pl-');
    expect(plan.strategy.addClasses).not.toContain('shadow');
    // Both keys should still be in removeForProperties
    expect(plan.strategy.removeForProperties).toContain('shadow');
    expect(plan.strategy.removeForProperties).toContain('paddingLeft');
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

  it('sets target filePath and elementRef from sourceOwner', () => {
    const plan = writer.createPlan({
      context: { ...baseContext, requestedStyles: { paddingLeft: '16' } },
      sourceOwner: baseOwner,
    });
    expect(plan.target.filePath).toBe('src/App.tsx');
    expect(plan.target.elementRef).toBe('src/App.tsx:12:4');
  });
});
