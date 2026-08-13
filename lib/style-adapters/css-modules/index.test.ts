/**
 * @file CssModulesAdapter umbrella tests — verifies adapter wiring of reader + writer
 *
 * Accessed via: bun test lib/style-adapters/css-modules/index.test.ts
 * Assumptions: CssModulesWriter is tested independently in writer.test.ts;
 *   these tests verify adapter shape and basic delegation only
 */
import { describe, expect, it } from 'bun:test';
import { cssModulesAdapter } from './index';

describe('CssModulesAdapter', () => {
  it('has id css-modules', () => {
    expect(cssModulesAdapter.id).toBe('css-modules');
  });

  it('has writer', () => {
    expect(cssModulesAdapter.writer).toBeDefined();
  });

  it('has reader', () => {
    expect(cssModulesAdapter.reader).toBeDefined();
  });

  it('reader exposes CSS Module class identities from className facts', async () => {
    if (!cssModulesAdapter.reader) throw new Error('reader is undefined');
    const result = await cssModulesAdapter.reader.read({
      elementFacts: {
        elementCssSystems: ['css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
        classNameExpression: {
          kind: 'member-expression',
          staticClasses: [],
          dynamic: true,
          cssModuleReferences: [
            {
              importLocalName: 'styles',
              importSource: './Card.module.css',
              cssFilePath: 'src/Card.module.css',
              cssSyntax: 'css',
              classKey: 'card',
              selector: '.card',
              expressionPath: 'styles.card',
            },
          ],
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
          sourceTabId: 'css-modules:card',
          cssSystem: 'css-modules',
          sourceForm: 'cssStyleRule',
          label: '.card',
          filePath: 'src/Card.module.css',
          cssSyntax: 'css',
          selector: '.card',
          classKey: 'card',
          sourceRef: {
            importLocalName: 'styles',
            importSource: './Card.module.css',
            expressionPath: 'styles.card',
          },
          condition: { state: 'base' },
          confidence: 'exact',
        },
      ],
      conditions: [{ state: 'base' }],
    });
  });

  it('writer produces CssModulesFilePlan', () => {
    if (!cssModulesAdapter.writer) throw new Error('writer is undefined');
    const plan = cssModulesAdapter.writer.createPlan({
      context: {
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
        requestedStyles: { paddingLeft: '16' },
      },
      sourceOwner: {
        cssSystem: 'css-modules',
        sourceForm: 'cssStyleRule',
        cssSyntax: 'css',
        filePath: 'src/Card.module.css',
        selector: '.card',
        property: 'padding-left',
        condition: { state: 'base' },
        confidence: 'exact',
      },
    });
    expect(plan.sourceForm).toBe('cssStyleRule');
    expect(plan.cssSystem).toBe('css-modules');
  });
});
