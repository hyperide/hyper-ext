/**
 * @file Type-level tests for style-read types
 *
 * Accessed via: bun run test lib/style-read/types.test.ts
 * Assumptions: types are importable and values satisfy type constraints
 */
import { describe, expect, it } from 'bun:test';
import type {
  CascadeContext,
  CssSystemId,
  ProjectStyleCapabilities,
  SourceConfidence,
  SourceForm,
  StyleCondition,
  StyleSourceOwner,
  StyleSourceTab,
} from './types';

describe('style-read types', () => {
  it('CssSystemId covers all supported systems', () => {
    const systems: CssSystemId[] = [
      'tailwind-v3',
      'tailwind-v4',
      'css-modules',
      'plain-css',
      'inline-style',
      'emotion',
      'styled-components',
      'vanilla-extract',
      'mui-system',
      'chakra-ui',
      'mantine',
      'tamagui',
    ];
    expect(systems).toHaveLength(12);
  });

  it('SourceForm covers all write surfaces', () => {
    const forms: SourceForm[] = [
      'elementClass',
      'cssStyleRule',
      'scriptReactStyleRule',
      'scriptNativeStyleRule',
      'adapterKnownElementProp',
      'arbitraryElementProp',
    ];
    expect(forms).toHaveLength(6);
  });

  it('SourceConfidence has three levels', () => {
    const levels: SourceConfidence[] = ['exact', 'probable', 'computed-only'];
    expect(levels).toHaveLength(3);
  });

  it('StyleSourceOwner has required fields', () => {
    const owner: StyleSourceOwner = {
      cssSystem: 'css-modules',
      sourceForm: 'cssStyleRule',
      cssSyntax: 'css',
      filePath: 'src/Card.module.css',
      selector: '.card',
      property: 'padding-left',
      condition: { state: 'base' },
      confidence: 'exact',
    };
    expect(owner.cssSystem).toBe('css-modules');
    expect(owner.sourceForm).toBe('cssStyleRule');
    expect(owner.condition.state).toBe('base');
  });

  it('StyleCondition composes theme + viewport + state', () => {
    const condition: StyleCondition = {
      state: 'hover',
      viewport: {
        kind: 'viewport',
        key: 'md',
        minWidthPx: 768,
        source: 'tailwind-screens',
      },
      theme: [
        {
          axis: 'color-scheme',
          value: 'dark',
          source: 'tailwind-dark-selector',
          selector: '.dark &',
        },
      ],
    };
    expect(condition.state).toBe('hover');
    expect(condition.viewport?.key).toBe('md');
    expect(condition.theme?.[0].value).toBe('dark');
  });

  it('CascadeContext is separate from StyleCondition', () => {
    const cascade: CascadeContext = {
      layer: 'components',
      scope: { rootSelector: '.card' },
      atRuleStack: [{ name: 'layer', params: 'components' }],
    };
    expect(cascade.layer).toBe('components');
  });

  it('StyleSourceTab has Computed tab without cssSystem', () => {
    const computed: StyleSourceTab = {
      id: 'computed',
      label: 'Computed',
      condition: { state: 'base' },
      confidence: 'computed-only',
    };
    expect(computed.cssSystem).toBeUndefined();
    expect(computed.sourceForm).toBeUndefined();
  });

  it('StyleSourceTab has source tab with cssSystem', () => {
    const tab: StyleSourceTab = {
      id: 'css-modules:card',
      label: '.card',
      cssSystem: 'css-modules',
      sourceForm: 'cssStyleRule',
      cssSyntax: 'css',
      filePath: 'src/Card.module.css',
      selector: '.card',
      condition: { state: 'base' },
      confidence: 'exact',
    };
    expect(tab.cssSystem).toBe('css-modules');
    expect(tab.label).toBe('.card');
  });

  it('ProjectStyleCapabilities uses arrays for multiple systems', () => {
    const caps: ProjectStyleCapabilities = {
      projectCssSystems: ['tailwind-v4', 'css-modules'],
      projectUiKits: ['shadcn-ui'],
      componentPropMappers: [],
      cssSyntaxes: ['css'],
      projectThemeCapabilities: {
        axes: [],
        mechanisms: ['tailwind-dark-variant'],
        tokenSources: [],
      },
      packageEvidence: [],
      configEvidence: [],
      sourceEvidence: [],
    };
    expect(caps.projectCssSystems).toContain('tailwind-v4');
    expect(caps.projectCssSystems).toContain('css-modules');
  });
});
