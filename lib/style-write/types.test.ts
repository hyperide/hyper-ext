/**
 * @file Type-level tests for style-write plan types
 *
 * Accessed via: bun run test lib/style-write/types.test.ts
 * Assumptions: types are importable and plan union discriminates correctly
 */
import { describe, expect, it } from 'bun:test';
import type {
  AdapterPropPlan,
  ArbitraryPropPlan,
  CssModulesFilePlan,
  PlainCssExistingOwnerPlan,
  ScriptObjectStylePlan,
  StyleWriteContext,
  StyleWriteResult,
  TailwindPlan,
} from './types';

describe('StyleWritePlan union', () => {
  it('TailwindPlan discriminates by sourceForm elementClass', () => {
    const plan: TailwindPlan = {
      id: 'plan-1',
      sourceForm: 'elementClass',
      cssSystem: 'tailwind-v4',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:12:4' },
      requestedStyles: { paddingLeft: '16' },
      targetStyles: { paddingLeft: '16' },
      condition: { state: 'base' },
      reason: 'project-primary-system',
      confidence: 'exact',
      diagnostics: [],
      strategy: {
        mode: 'static',
        removeForProperties: ['paddingLeft'],
        addClasses: 'pl-[16px]',
      },
      target: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:12:4' },
    };
    expect(plan.sourceForm).toBe('elementClass');
    expect(plan.strategy.mode).toBe('static');
  });

  it('CssModulesFilePlan discriminates by cssSystem css-modules', () => {
    const plan: CssModulesFilePlan = {
      id: 'plan-2',
      sourceForm: 'cssStyleRule',
      cssSystem: 'css-modules',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:20:6' },
      requestedStyles: { paddingLeft: '16' },
      targetStyles: { paddingLeft: '16px' },
      condition: { state: 'base' },
      reason: 'existing-owner',
      confidence: 'exact',
      diagnostics: [],
      target: {
        cssFilePath: 'src/App.module.css',
        cssSyntax: 'css',
        selector: '.app',
        declarations: { 'padding-left': '16px' },
        importSource: './App.module.css',
        importLocalName: 'styles',
        classKey: 'app',
      },
    };
    expect(plan.sourceForm).toBe('cssStyleRule');
    expect(plan.cssSystem).toBe('css-modules');
  });

  it('PlainCssExistingOwnerPlan has mode existing-owner', () => {
    const plan: PlainCssExistingOwnerPlan = {
      id: 'plan-3',
      sourceForm: 'cssStyleRule',
      cssSystem: 'plain-css',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:8:4' },
      requestedStyles: { color: 'red' },
      targetStyles: { color: 'red' },
      condition: { state: 'base' },
      reason: 'existing-owner',
      confidence: 'exact',
      diagnostics: [],
      target: {
        mode: 'existing-owner',
        cssFilePath: 'src/global.css',
        cssSyntax: 'css',
        selector: '.card',
        declarations: { color: 'red' },
        cascadeOwner: {
          cssSystem: 'plain-css',
          sourceForm: 'cssStyleRule',
          filePath: 'src/global.css',
          selector: '.card',
          property: 'color',
          condition: { state: 'base' },
          confidence: 'exact',
        },
      },
    };
    expect(plan.target.mode).toBe('existing-owner');
  });

  it('ScriptObjectStylePlan discriminates by scriptReactStyleRule', () => {
    const plan: ScriptObjectStylePlan = {
      id: 'plan-4',
      sourceForm: 'scriptReactStyleRule',
      cssSystem: 'inline-style',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:8:4' },
      requestedStyles: { opacity: '50' },
      targetStyles: { opacity: '0.5' },
      condition: { state: 'base' },
      reason: 'existing-owner',
      confidence: 'exact',
      diagnostics: [],
      target: {
        filePath: 'src/App.tsx',
        objectPath: 'JSXAttribute[name=style]/JSXExpressionContainer/ObjectExpression',
        styles: { opacity: '0.5' },
        mergeMode: 'object',
      },
    };
    expect(plan.sourceForm).toBe('scriptReactStyleRule');
  });

  it('AdapterPropPlan requires mapperId for standard-style-inspector origin', () => {
    const plan: AdapterPropPlan = {
      id: 'plan-5',
      sourceForm: 'adapterKnownElementProp',
      cssSystem: 'tamagui',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/Card.tsx', elementRef: 'src/Card.tsx:8:4', tagName: 'YStack' },
      requestedStyles: { opacity: '50' },
      targetStyles: { opacity: 0.5 },
      condition: { state: 'base' },
      reason: 'existing-owner',
      confidence: 'exact',
      diagnostics: [],
      target: {
        filePath: 'src/Card.tsx',
        elementRef: 'src/Card.tsx:8:4',
        mapperId: 'tamagui',
        origin: 'standard-style-inspector',
        props: { opacity: 0.5 },
        propPaths: [['opacity']],
      },
    };
    expect(plan.target.mapperId).toBe('tamagui');
    expect(plan.target.origin).toBe('standard-style-inspector');
  });

  it('ArbitraryPropPlan has empty requestedStyles and targetStyles', () => {
    const plan: ArbitraryPropPlan = {
      id: 'plan-6',
      sourceForm: 'arbitraryElementProp',
      projectRoot: '/project',
      sourceElement: { filePath: 'src/Card.tsx', elementRef: 'src/Card.tsx:8:4' },
      requestedStyles: {},
      targetStyles: {},
      condition: { state: 'base' },
      reason: 'explicit-prop-edit',
      confidence: 'exact',
      diagnostics: [],
      target: {
        filePath: 'src/Card.tsx',
        elementRef: 'src/Card.tsx:8:4',
        origin: 'recursive-props-editor',
        props: { variant: 'solid' },
        propPaths: [['variant']],
      },
    };
    expect(Object.keys(plan.requestedStyles)).toHaveLength(0);
    expect(Object.keys(plan.targetStyles)).toHaveLength(0);
  });

  it('StyleWriteContext carries per-request runtime theme context', () => {
    const ctx: StyleWriteContext = {
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
        ideThemePreference: 'dark',
        resolvedColorScheme: 'dark',
        source: 'vscode',
      },
      condition: { state: 'base' },
      requestedStyles: { paddingLeft: '16' },
    };
    expect(ctx.runtimeThemeContext.resolvedColorScheme).toBe('dark');
  });

  it('StyleWriteResult indicates success or failure', () => {
    const success: StyleWriteResult = {
      success: true,
      plan: {
        id: 'plan-1',
        sourceForm: 'elementClass',
        cssSystem: 'tailwind-v4',
        projectRoot: '/project',
        sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:12:4' },
        requestedStyles: { paddingLeft: '16' },
        targetStyles: { paddingLeft: '16' },
        condition: { state: 'base' },
        reason: 'project-primary-system',
        confidence: 'exact',
        diagnostics: [],
        strategy: { mode: 'static', removeForProperties: ['paddingLeft'], addClasses: 'pl-[16px]' },
        target: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:12:4' },
      },
      mutatedFiles: ['src/App.tsx'],
    };
    expect(success.success).toBe(true);

    const failure: StyleWriteResult = {
      success: false,
      error: 'CSS file not found: src/App.module.css',
    };
    expect(failure.success).toBe(false);
  });
});
