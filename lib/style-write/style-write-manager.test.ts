/**
 * @file StyleWriteManager tests — verifies shared orchestration from planner to executor
 *
 * Accessed via: bun run test lib/style-write/style-write-manager.test.ts
 * Assumptions: platform-specific code supplies the executor; the shared manager
 *   owns orchestration only and does not mutate files directly.
 */
import { describe, expect, it } from 'bun:test';
import type { StyleSourceOwner } from '@lib/style-read/types';
import { DefaultStyleWriteManager, type StyleWritePlanExecutor } from './style-write-manager';
import type {
  FrameworkStyleAdapter,
  FrameworkStyleWriter,
  StyleWriteContext,
  StyleWritePlan,
  StyleWritePlanner,
  StyleWriteResult,
} from './types';

function makeContext(overrides: Partial<StyleWriteContext> = {}): StyleWriteContext {
  return {
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
    requestedStyles: { paddingLeft: '16' },
    ...overrides,
  };
}

function makeOwner(overrides: Partial<StyleSourceOwner> = {}): StyleSourceOwner {
  return {
    cssSystem: 'inline-style',
    sourceForm: 'scriptReactStyleRule',
    filePath: 'src/App.tsx',
    elementRef: 'src/App.tsx:7:4',
    property: 'padding-left',
    condition: { state: 'base' },
    confidence: 'exact',
    ...overrides,
  };
}

function makePlan(overrides: Partial<StyleWritePlan> = {}): StyleWritePlan {
  return {
    id: 'plan-1',
    sourceForm: 'scriptReactStyleRule',
    cssSystem: 'inline-style',
    projectRoot: '/project',
    sourceElement: {
      filePath: 'src/App.tsx',
      elementRef: 'src/App.tsx:7:4',
      tagName: 'div',
    },
    requestedStyles: { paddingLeft: '16' },
    targetStyles: { paddingLeft: '16px' },
    condition: { state: 'base' },
    reason: 'existing-owner',
    confidence: 'exact',
    diagnostics: [],
    target: {
      filePath: 'src/App.tsx',
      elementRef: 'src/App.tsx:7:4',
      objectPath: 'JSXAttribute[name=style]',
      styles: { paddingLeft: '16px' },
      mergeMode: 'object',
    },
    ...overrides,
  };
}

describe('DefaultStyleWriteManager', () => {
  it('delegates plan creation to the planner-selected writer', async () => {
    const context = makeContext();
    const sourceOwner = makeOwner();
    const expectedPlan = makePlan();
    const writerCalls: Array<{ context: StyleWriteContext; sourceOwner: StyleSourceOwner }> = [];

    const writer: FrameworkStyleWriter = {
      createPlan(input) {
        writerCalls.push(input);
        return expectedPlan;
      },
    };
    const adapter: FrameworkStyleAdapter = { id: 'inline-style', writer };
    const planner: StyleWritePlanner = {
      selectTarget(ctx) {
        expect(ctx).toBe(context);
        return { adapter, writer, sourceOwner };
      },
    };
    const executor: StyleWritePlanExecutor = {
      async execute(plan) {
        return { success: true, plan, mutatedFiles: [] };
      },
    };

    const manager = new DefaultStyleWriteManager({ planner, executor });
    const plan = await manager.createPlan(context);

    expect(plan).toBe(expectedPlan);
    expect(writerCalls).toEqual([{ context, sourceOwner }]);
  });

  it('delegates execution to the injected platform executor', async () => {
    const plan = makePlan();
    const executionResult: StyleWriteResult = {
      success: true,
      plan,
      mutatedFiles: ['src/App.tsx'],
    };
    const executedPlans: StyleWritePlan[] = [];
    const manager = new DefaultStyleWriteManager({
      planner: {
        selectTarget() {
          throw new Error('not used');
        },
      },
      executor: {
        async execute(inputPlan) {
          executedPlans.push(inputPlan);
          return executionResult;
        },
      },
    });

    const result = await manager.execute(plan);

    expect(result).toBe(executionResult);
    expect(executedPlans).toEqual([plan]);
  });

  it('returns a failed write result when the platform executor throws', async () => {
    const plan = makePlan();
    const manager = new DefaultStyleWriteManager({
      planner: {
        selectTarget() {
          throw new Error('not used');
        },
      },
      executor: {
        async execute() {
          throw new Error('write failed');
        },
      },
    });

    const result = await manager.execute(plan);

    expect(result).toEqual({
      success: false,
      plan,
      error: 'write failed',
    });
  });
});
