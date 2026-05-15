/**
 * @file InlineStyleAdapter umbrella tests — verifies adapter wiring of reader + writer
 *
 * Accessed via: bun test lib/style-adapters/inline-style/index.test.ts
 * Assumptions: InlineStyleWriter is tested independently in writer.test.ts;
 *   these tests verify adapter shape and basic delegation only
 */
import { describe, expect, it } from 'bun:test';
import { inlineStyleAdapter } from './index';

describe('InlineStyleAdapter', () => {
  it('has id inline-style', () => {
    expect(inlineStyleAdapter.id).toBe('inline-style');
  });

  it('has writer', () => {
    expect(inlineStyleAdapter.writer).toBeDefined();
  });

  it('has reader', () => {
    expect(inlineStyleAdapter.reader).toBeDefined();
  });

  it('reader returns empty array (stub)', () => {
    if (!inlineStyleAdapter.reader) throw new Error('reader is undefined');
    const owners = inlineStyleAdapter.reader.read({
      elementFacts: {
        elementCssSystems: ['inline-style'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
      condition: { state: 'base' },
    });
    expect(owners).toEqual([]);
  });

  it('writer produces ScriptObjectStylePlan', () => {
    if (!inlineStyleAdapter.writer) throw new Error('writer is undefined');
    const plan = inlineStyleAdapter.writer.createPlan({
      context: {
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
      },
      sourceOwner: {
        cssSystem: 'inline-style',
        sourceForm: 'scriptReactStyleRule',
        filePath: 'src/App.tsx',
        property: 'padding-left',
        condition: { state: 'base' },
        confidence: 'exact',
      },
    });
    expect(plan.sourceForm).toBe('scriptReactStyleRule');
  });
});
