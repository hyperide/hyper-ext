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
