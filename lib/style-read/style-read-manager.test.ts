/**
 * @file StyleReadManager tests — verifies shared source tabs and property source aggregation
 *
 * Accessed via: bun test lib/style-read/style-read-manager.test.ts
 * Assumptions: framework adapter readers return canonical inspector values; the manager
 *   coordinates readers, tabs, surface decisions, and diagnostics without reading files directly.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it } from 'bun:test';
import type { FrameworkStyleAdapter } from '@lib/style-write/types';
import { DefaultStyleReadManager } from './style-read-manager';
import type {
  ElementStyleFacts,
  FrameworkReadResult,
  ProjectStyleCapabilities,
  RuntimeThemeContext,
  StyleReadContext,
  StyleSourceOwner,
} from './types';

function makeProjectCapabilities(overrides: Partial<ProjectStyleCapabilities> = {}): ProjectStyleCapabilities {
  return {
    projectCssSystems: ['tailwind-v4', 'css-modules', 'inline-style'],
    projectUiKits: [],
    componentPropMappers: [],
    cssSyntaxes: ['css'],
    projectThemeCapabilities: { axes: [], mechanisms: [], tokenSources: [] },
    packageEvidence: [],
    configEvidence: [],
    sourceEvidence: [],
    ...overrides,
  };
}

function makeElementFacts(overrides: Partial<ElementStyleFacts> = {}): ElementStyleFacts {
  return {
    elementCssSystems: ['tailwind-v4', 'css-modules'],
    elementUiKits: [],
    elementPropMappers: [],
    sourceOwners: [],
    componentFacts: { intrinsicElement: 'div' },
    componentPropSurface: {
      acceptsClassName: true,
      acceptsStyle: true,
      acceptsCssProp: false,
      acceptsSxProp: false,
      recursivePropsSchemaAvailable: false,
      styleLikeProps: [],
      semanticProps: [],
    },
    ...overrides,
  };
}

function makeRuntimeThemeContext(): RuntimeThemeContext {
  return {
    ideThemePreference: 'light',
    resolvedColorScheme: 'light',
    source: 'test-fixture',
  };
}

function makeContext(overrides: Partial<StyleReadContext> = {}): StyleReadContext {
  return {
    projectCapabilities: makeProjectCapabilities(),
    elementFacts: makeElementFacts(),
    runtimeThemeContext: makeRuntimeThemeContext(),
    computedStyle: {
      'padding-left': '20px',
      color: 'rgb(239, 68, 68)',
    },
    ...overrides,
  };
}

function makeOwner(overrides: Partial<StyleSourceOwner> = {}): StyleSourceOwner {
  return {
    cssSystem: 'css-modules',
    sourceForm: 'cssStyleRule',
    cssSyntax: 'css',
    filePath: 'src/Card.module.css',
    selector: '.card',
    property: 'padding-left',
    condition: { state: 'base' },
    confidence: 'exact',
    ...overrides,
  };
}

function makeReadResult(overrides: Partial<FrameworkReadResult> = {}): FrameworkReadResult {
  return {
    sourceOwners: [makeOwner()],
    values: { 'padding-left': '16' },
    classIdentities: [],
    conditions: [{ state: 'base' }],
    ...overrides,
  };
}

describe('DefaultStyleReadManager', () => {
  it('calls active framework readers with read context infrastructure', async () => {
    const received: unknown[] = [];
    const adapter: FrameworkStyleAdapter = {
      id: 'css-modules',
      reader: {
        async read(input) {
          received.push(input);
          return makeReadResult();
        },
      },
    };
    const context = makeContext();
    const manager = new DefaultStyleReadManager({ adapters: [adapter] });

    await manager.read(context);

    expect(received).toEqual([
      {
        elementFacts: context.elementFacts,
        computedStyle: context.computedStyle,
        fiberTrace: undefined,
        runtimeThemeContext: context.runtimeThemeContext,
      },
    ]);
  });

  it('builds Computed plus concrete source tabs from reader source owners', async () => {
    const adapter: FrameworkStyleAdapter = {
      id: 'css-modules',
      reader: {
        async read() {
          return makeReadResult();
        },
      },
    };
    const manager = new DefaultStyleReadManager({ adapters: [adapter] });

    const result = await manager.read(makeContext());

    expect(result.sourceTabs.map((tab) => tab.id)).toEqual(['computed', 'css-modules:card']);
    expect(result.sourceTabs[0]).toEqual({
      id: 'computed',
      label: 'Computed',
      condition: { state: 'base' },
      confidence: 'computed-only',
      isDefault: true,
    });
    expect(result.sourceTabs[1]).toMatchObject({
      id: 'css-modules:card',
      label: '.card',
      cssSystem: 'css-modules',
      sourceForm: 'cssStyleRule',
      cssSyntax: 'css',
      filePath: 'src/Card.module.css',
      selector: '.card',
      confidence: 'exact',
      isDefault: false,
    });
  });

  it('builds concrete source tabs from element facts when no adapter reader owns them yet', async () => {
    const manager = new DefaultStyleReadManager({ adapters: [] });

    const result = await manager.read(
      makeContext({
        elementFacts: makeElementFacts({
          sourceOwners: [makeOwner({ selector: '.fact-card' })],
        }),
      }),
    );

    expect(result.sourceTabs.map((tab) => tab.id)).toEqual(['computed', 'css-modules:fact-card']);
  });

  it('returns computed and concrete property sources', async () => {
    const adapter: FrameworkStyleAdapter = {
      id: 'css-modules',
      reader: {
        async read() {
          return makeReadResult();
        },
      },
    };
    const manager = new DefaultStyleReadManager({ adapters: [adapter] });

    const result = await manager.read(makeContext());

    expect(result.properties).toContainEqual({
      property: 'padding-left',
      value: '20px',
      sourceTabId: 'computed',
      active: true,
    });
    expect(result.properties).toContainEqual({
      property: 'padding-left',
      value: '16',
      sourceTabId: 'css-modules:card',
      active: false,
    });
  });

  it('keeps empty concrete values returned by adapter readers', async () => {
    const adapter: FrameworkStyleAdapter = {
      id: 'css-modules',
      reader: {
        async read() {
          return makeReadResult({ values: { 'padding-left': '' } });
        },
      },
    };
    const manager = new DefaultStyleReadManager({ adapters: [adapter] });

    const result = await manager.read(makeContext());

    expect(result.properties).toContainEqual({
      property: 'padding-left',
      value: '',
      sourceTabId: 'css-modules:card',
      active: false,
    });
  });

  it('ignores adapters outside project css systems', async () => {
    let called = false;
    const adapter: FrameworkStyleAdapter = {
      id: 'tailwind-v4',
      reader: {
        async read() {
          called = true;
          return makeReadResult();
        },
      },
    };
    const manager = new DefaultStyleReadManager({ adapters: [adapter] });

    const result = await manager.read(
      makeContext({
        projectCapabilities: makeProjectCapabilities({ projectCssSystems: ['css-modules'] }),
      }),
    );

    expect(called).toBe(false);
    expect(result.sourceTabs.map((tab) => tab.id)).toEqual(['computed']);
  });

  it('selects props editor surface from element prop mapper facts', async () => {
    const manager = new DefaultStyleReadManager({ adapters: [] });

    const result = await manager.read(
      makeContext({
        elementFacts: makeElementFacts({
          elementCssSystems: [],
          elementPropMappers: ['tamagui'],
          componentFacts: { componentName: 'YStack' },
          componentPropSurface: {
            acceptsClassName: false,
            acceptsStyle: false,
            acceptsCssProp: false,
            acceptsSxProp: false,
            recursivePropsSchemaAvailable: true,
            styleLikeProps: ['padding'],
            semanticProps: [],
          },
        }),
      }),
    );

    expect(result.surfaceDecision).toEqual({
      standardStyleInspector: 'enabled',
      propsEditor: 'compact',
      reasons: ['adapter-known-prop-mapper'],
    });
  });
});
