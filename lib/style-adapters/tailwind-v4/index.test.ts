/**
 * @file TailwindV4Adapter umbrella tests — verifies adapter wiring of reader + writer
 *
 * Accessed via: bun test lib/style-adapters/tailwind-v4/index.test.ts
 * Assumptions: TailwindV4Writer is tested independently in writer.test.ts;
 *   these tests verify adapter shape and basic delegation only
 */
import { describe, expect, it } from 'bun:test';
import { tailwindV4Adapter } from './index';

describe('TailwindV4Adapter', () => {
  it('has id tailwind-v4', () => {
    expect(tailwindV4Adapter.id).toBe('tailwind-v4');
  });

  it('has writer', () => {
    expect(tailwindV4Adapter.writer).toBeDefined();
  });

  it('has reader', () => {
    expect(tailwindV4Adapter.reader).toBeDefined();
  });

  it('reader returns element class identity when className facts are available', async () => {
    if (!tailwindV4Adapter.reader) throw new Error('reader is undefined');
    const result = await tailwindV4Adapter.reader.read({
      elementFacts: {
        elementCssSystems: ['tailwind-v4'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
        classNameExpression: {
          kind: 'literal',
          staticClasses: ['px-4', 'text-red-500'],
          dynamic: false,
        },
      },
      computedStyle: {},
      runtimeThemeContext: {
        ideThemePreference: 'light',
        resolvedColorScheme: 'light',
        source: 'test-fixture',
      },
    });
    expect(result).toEqual({
      sourceOwners: [],
      values: {},
      classIdentities: [
        {
          sourceTabId: 'tailwind-v4:elementClass',
          cssSystem: 'tailwind-v4',
          sourceForm: 'elementClass',
          label: 'Tailwind',
          cssClass: 'px-4 text-red-500',
          condition: { state: 'base' },
          confidence: 'exact',
        },
      ],
      conditions: [{ state: 'base' }],
    });
  });

  it('reader emits ONE Tailwind identity and keeps per-class confidence as metadata (HYP-553)', async () => {
    if (!tailwindV4Adapter.reader) throw new Error('reader is undefined');
    // cn("px-4 flex", isActive && "bg-red-500")
    const result = await tailwindV4Adapter.reader.read({
      elementFacts: {
        elementCssSystems: ['tailwind-v4'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
        classNameExpression: {
          kind: 'call-expression',
          staticClasses: ['px-4', 'flex', 'bg-red-500'],
          dynamic: true,
          staticLiteralClasses: ['px-4', 'flex'],
          dynamicBranchClasses: ['bg-red-500'],
        },
      },
      computedStyle: {},
      runtimeThemeContext: {
        ideThemePreference: 'light',
        resolvedColorScheme: 'light',
        source: 'test-fixture',
      },
    });

    // The confidence split must NOT spawn a second source tab: exactly one Tailwind identity,
    // one sourceTabId, so RightSidebar renders a single "Tailwind" button (not two identical ones).
    expect(result.classIdentities).toHaveLength(1);
    const identity = result.classIdentities[0];
    expect(identity.sourceTabId).toBe('tailwind-v4:elementClass');
    expect(identity.label).toBe('Tailwind');
    expect(identity.cssClass).toBe('px-4 flex bg-red-500');
    // Having a statically-certain branch keeps the join 'exact' (HYP-553: one dynamic branch
    // no longer downgrades the whole identity).
    expect(identity.confidence).toBe('exact');

    // Per-class confidence is preserved as metadata on the single identity.
    expect(identity.classConfidences).toEqual([
      { cssClass: 'px-4', confidence: 'exact' },
      { cssClass: 'flex', confidence: 'exact' },
      { cssClass: 'bg-red-500', confidence: 'probable' },
    ]);
  });

  it('writer produces TailwindPlan', () => {
    if (!tailwindV4Adapter.writer) throw new Error('writer is undefined');
    const plan = tailwindV4Adapter.writer.createPlan({
      context: {
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
        requestedStyles: { paddingLeft: '16' },
      },
      sourceOwner: {
        cssSystem: 'tailwind-v4',
        sourceForm: 'elementClass',
        filePath: 'src/App.tsx',
        property: 'padding-left',
        condition: { state: 'base' },
        confidence: 'exact',
      },
    });
    expect(plan.sourceForm).toBe('elementClass');
  });
});
