/**
 * @file StyleWritePlanner tests — verifies adapter selection priority policy
 *
 * Accessed via: bun run test lib/style-write/style-write-planner.test.ts
 * Assumptions: adapters are real instances from lib/style-adapters/;
 *   tests exercise the full selection priority chain from Step 1 through Step 6
 */
import { describe, expect, it } from 'bun:test';
import { cssModulesAdapter } from '@lib/style-adapters/css-modules';
import { inlineStyleAdapter } from '@lib/style-adapters/inline-style';
import { tailwindV4Adapter } from '@lib/style-adapters/tailwind-v4';
import type { StyleSourceOwner } from '@lib/style-read/types';
import { DefaultStyleWritePlanner } from './style-write-planner';
import type { FrameworkStyleAdapter, StyleWriteContext } from './types';

function makeContext(overrides: Partial<StyleWriteContext> = {}): StyleWriteContext {
  return {
    projectCapabilities: {
      projectCssSystems: [],
      projectUiKits: [],
      componentPropMappers: [],
      cssSyntaxes: ['css'],
      projectThemeCapabilities: { axes: [], mechanisms: [], tokenSources: [] },
      packageEvidence: [],
      configEvidence: [],
      sourceEvidence: [],
    },
    elementFacts: {
      elementCssSystems: [],
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
    cssSystem: 'css-modules',
    sourceForm: 'cssStyleRule',
    filePath: 'src/App.module.css',
    property: 'padding-left',
    condition: { state: 'base' },
    confidence: 'exact',
    ...overrides,
  };
}

/** Adapter with no writer — simulates an adapter that only has a reader */
const writerlessAdapter: FrameworkStyleAdapter = {
  id: 'plain-css',
  reader: undefined,
  writer: undefined,
};

describe('DefaultStyleWritePlanner', () => {
  const planner = new DefaultStyleWritePlanner([tailwindV4Adapter, cssModulesAdapter, inlineStyleAdapter]);

  // --- Step 1: Explicit source tab ---

  it('selects adapter matching explicit source tab', () => {
    const ctx = makeContext({
      selectedSourceTabId: 'css-modules:card',
      elementFacts: {
        elementCssSystems: ['tailwind-v4', 'css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({ cssSystem: 'tailwind-v4', sourceForm: 'elementClass', property: 'padding-left' }),
          makeOwner({ cssSystem: 'css-modules', sourceForm: 'cssStyleRule', property: 'color' }),
        ],
      },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('css-modules');
    expect(result.writer).toBeDefined();
  });

  it('selects the correct owner when multiple owners share the same cssSystem', () => {
    const ctx = makeContext({
      selectedSourceTabId: 'css-modules:featured',
      elementFacts: {
        elementCssSystems: ['css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({ cssSystem: 'css-modules', selector: '.card', property: 'padding-left' }),
          makeOwner({ cssSystem: 'css-modules', selector: '.featured', property: 'color' }),
        ],
      },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('css-modules');
    // Should match the .featured owner, not the .card owner
    expect(result.sourceOwner.selector).toBe('.featured');
  });

  it('falls back to system prefix match when exact tab ID does not match', () => {
    const ctx = makeContext({
      selectedSourceTabId: 'css-modules:nonexistent',
      elementFacts: {
        elementCssSystems: ['css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [makeOwner({ cssSystem: 'css-modules', selector: '.card' })],
      },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('css-modules');
  });

  it('falls through when selectedSourceTabId does not match any owner system', () => {
    const ctx = makeContext({
      selectedSourceTabId: 'emotion:container',
      elementFacts: {
        elementCssSystems: ['css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [makeOwner({ cssSystem: 'css-modules' })],
      },
    });

    const result = planner.selectTarget(ctx);
    // Should fall through to Step 2 or Step 3, picking css-modules
    expect(result.adapter.id).toBe('css-modules');
  });

  // --- Step 2: Existing exact owner ---

  it('selects existing exact owner for the property', () => {
    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['tailwind-v4', 'css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({
            cssSystem: 'css-modules',
            property: 'padding-left',
            confidence: 'exact',
          }),
        ],
      },
      requestedStyles: { paddingLeft: '16' },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('css-modules');
    expect(result.sourceOwner.property).toBe('padding-left');
    expect(result.sourceOwner.confidence).toBe('exact');
  });

  it('does not select probable owner as exact', () => {
    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({
            cssSystem: 'css-modules',
            property: 'padding-left',
            confidence: 'probable',
          }),
        ],
      },
      requestedStyles: { paddingLeft: '16' },
    });

    const result = planner.selectTarget(ctx);
    // Skips Step 2 (probable, not exact), falls to Step 3 (single element system)
    expect(result.adapter.id).toBe('css-modules');
    // Source owner should be synthetic (from Step 3), not the probable one
    expect(result.sourceOwner.confidence).toBe('exact');
  });

  it('matches camelCase requestedStyles keys to kebab-case owner.property', () => {
    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['tailwind-v4'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({
            cssSystem: 'tailwind-v4',
            sourceForm: 'elementClass',
            property: 'margin-top',
            confidence: 'exact',
          }),
        ],
      },
      requestedStyles: { marginTop: '8' },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('tailwind-v4');
    expect(result.sourceOwner.property).toBe('margin-top');
  });

  it('skips owner when condition.state does not match', () => {
    const ctx = makeContext({
      condition: { state: 'hover' },
      elementFacts: {
        elementCssSystems: ['css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({
            cssSystem: 'css-modules',
            property: 'padding-left',
            confidence: 'exact',
            condition: { state: 'base' },
          }),
        ],
      },
      requestedStyles: { paddingLeft: '16' },
    });

    const result = planner.selectTarget(ctx);
    // Falls to Step 3 since condition mismatch skips Step 2
    expect(result.adapter.id).toBe('css-modules');
    // Synthetic owner should carry the hover condition
    expect(result.sourceOwner.condition.state).toBe('hover');
  });

  it('skips owner when viewport condition does not match', () => {
    const ctx = makeContext({
      condition: {
        state: 'base',
        viewport: { kind: 'viewport', key: 'md', minWidthPx: 768, source: 'tailwind-screens' },
      },
      elementFacts: {
        elementCssSystems: ['css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({
            cssSystem: 'css-modules',
            property: 'padding-left',
            confidence: 'exact',
            condition: { state: 'base' },
          }),
        ],
      },
      requestedStyles: { paddingLeft: '16' },
    });

    const result = planner.selectTarget(ctx);
    // Falls to Step 3 — the base owner has no viewport, so it shouldn't match md viewport edit
    expect(result.adapter.id).toBe('css-modules');
    expect(result.sourceOwner.condition.viewport?.key).toBe('md');
  });

  // --- Step 3: Element primary system ---

  it('selects sole element system for new properties', () => {
    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
      requestedStyles: { color: 'red' },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('css-modules');
    expect(result.sourceOwner.cssSystem).toBe('css-modules');
    expect(result.sourceOwner.sourceForm).toBe('cssStyleRule');
  });

  // --- Step 4: Mixed Tailwind priority ---

  it('prefers Tailwind for new properties on mixed Tailwind+CSS Modules element', () => {
    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['tailwind-v4', 'css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
      requestedStyles: { gap: '8' },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('tailwind-v4');
    expect(result.sourceOwner.cssSystem).toBe('tailwind-v4');
    expect(result.sourceOwner.sourceForm).toBe('elementClass');
  });

  // --- Mixed conflict (Case C) ---

  it('CSS Modules wins over Tailwind when both own the property', () => {
    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['tailwind-v4', 'css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({
            cssSystem: 'tailwind-v4',
            sourceForm: 'elementClass',
            property: 'padding-left',
            confidence: 'exact',
          }),
          makeOwner({
            cssSystem: 'css-modules',
            sourceForm: 'cssStyleRule',
            property: 'padding-left',
            confidence: 'exact',
          }),
        ],
      },
      requestedStyles: { paddingLeft: '16' },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('css-modules');
    expect(result.sourceOwner.cssSystem).toBe('css-modules');
  });

  it('CSS Modules wins regardless of source owner order', () => {
    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['tailwind-v4', 'css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({
            cssSystem: 'css-modules',
            sourceForm: 'cssStyleRule',
            property: 'padding-left',
            confidence: 'exact',
          }),
          makeOwner({
            cssSystem: 'tailwind-v4',
            sourceForm: 'elementClass',
            property: 'padding-left',
            confidence: 'exact',
          }),
        ],
      },
      requestedStyles: { paddingLeft: '16' },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('css-modules');
  });

  it('includes diagnostic when CSS Modules wins over Tailwind', () => {
    const plannerWithDiags = new DefaultStyleWritePlanner([tailwindV4Adapter, cssModulesAdapter, inlineStyleAdapter]);

    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['tailwind-v4', 'css-modules'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({
            cssSystem: 'css-modules',
            sourceForm: 'cssStyleRule',
            property: 'padding-left',
            confidence: 'exact',
          }),
          makeOwner({
            cssSystem: 'tailwind-v4',
            sourceForm: 'elementClass',
            property: 'padding-left',
            confidence: 'exact',
          }),
        ],
      },
      requestedStyles: { paddingLeft: '16' },
    });

    const result = plannerWithDiags.selectTargetWithDiagnostics(ctx);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].level).toBe('warning');
    expect(result.diagnostics[0].message).toContain('Tailwind');
    expect(result.diagnostics[0].message).toContain('.module.css');
  });

  // --- Step 5: Project primary ---

  it('falls back to project primary when no element system', () => {
    const ctx = makeContext({
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
        elementCssSystems: [],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('tailwind-v4');
  });

  it('prefers Tailwind over CSS Modules at project level', () => {
    const ctx = makeContext({
      projectCapabilities: {
        projectCssSystems: ['css-modules', 'tailwind-v4'],
        projectUiKits: [],
        componentPropMappers: [],
        cssSyntaxes: ['css'],
        projectThemeCapabilities: { axes: [], mechanisms: [], tokenSources: [] },
        packageEvidence: [],
        configEvidence: [],
        sourceEvidence: [],
      },
      elementFacts: {
        elementCssSystems: [],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('tailwind-v4');
  });

  it('falls back to CSS Modules at project level when Tailwind unavailable', () => {
    const ctx = makeContext({
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
        elementCssSystems: [],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('css-modules');
  });

  // --- Step 6: Inline fallback ---

  it('falls back to inline-style when no adapter matches', () => {
    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: [],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
    });

    const result = planner.selectTarget(ctx);
    expect(result.adapter.id).toBe('inline-style');
    expect(result.sourceOwner.cssSystem).toBe('inline-style');
    expect(result.sourceOwner.confidence).toBe('computed-only');
  });

  it('falls back to inline-style when selected adapter has no writer', () => {
    const plannerWithWriterless = new DefaultStyleWritePlanner([writerlessAdapter, inlineStyleAdapter]);

    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['plain-css'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
    });

    const result = plannerWithWriterless.selectTarget(ctx);
    expect(result.adapter.id).toBe('inline-style');
    expect(result.sourceOwner.confidence).toBe('computed-only');
  });

  it('throws when inline-style adapter is not registered', () => {
    const plannerWithoutFallback = new DefaultStyleWritePlanner([tailwindV4Adapter]);

    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: [],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
    });

    expect(() => plannerWithoutFallback.selectTarget(ctx)).toThrow('inline-style adapter must be registered');
  });

  // --- Synthetic owner shape ---

  it('creates synthetic owner with correct sourceForm for the system', () => {
    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['tailwind-v4'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [],
      },
      requestedStyles: { paddingLeft: '16' },
    });

    const result = planner.selectTarget(ctx);
    expect(result.sourceOwner.sourceForm).toBe('elementClass');
    expect(result.sourceOwner.property).toBe('padding-left');
    expect(result.sourceOwner.confidence).toBe('exact');
  });

  it('synthetic owner inherits filePath from first existing source owner', () => {
    const ctx = makeContext({
      elementFacts: {
        elementCssSystems: ['tailwind-v4'],
        elementUiKits: [],
        elementPropMappers: [],
        sourceOwners: [
          makeOwner({
            cssSystem: 'css-modules',
            filePath: 'src/Card.module.css',
            property: 'color',
            confidence: 'probable',
          }),
        ],
      },
      requestedStyles: { gap: '8' },
    });

    const result = planner.selectTarget(ctx);
    expect(result.sourceOwner.filePath).toBe('src/Card.module.css');
  });
});
