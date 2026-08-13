/**
 * @file Source-tab helper tests for inspector fallback tabs
 *
 * Accessed via: bun test client/components/RightSidebar/__tests__/source-tabs.test.ts
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it } from 'bun:test';
import {
  buildInspectorStyleSourceTabs,
  getExplicitStyleSourceTabId,
  resolveInspectorStyleSourceTabs,
} from '../source-tabs';

describe('buildInspectorStyleSourceTabs', () => {
  it('always returns Computed as the default aggregate tab', () => {
    const tabs = buildInspectorStyleSourceTabs({
      inspectorUIKit: 'none',
      componentPath: null,
      canInspectStyles: false,
    });

    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      id: 'computed',
      label: 'Computed',
      confidence: 'computed-only',
      isDefault: true,
    });
  });

  it('adds Tailwind element-class tab for Tailwind inspector writes', () => {
    const tabs = buildInspectorStyleSourceTabs({
      inspectorUIKit: 'tailwind',
      componentPath: 'src/Card.tsx',
      canInspectStyles: true,
    });

    expect(tabs.map((tab) => tab.id)).toEqual(['computed', 'tailwind-v4:elementClass']);
    expect(tabs[1]).toMatchObject({
      label: 'Tailwind',
      cssSystem: 'tailwind-v4',
      sourceForm: 'elementClass',
      filePath: 'src/Card.tsx',
    });
  });

  it('adds Props tab for Tamagui prop-backed writes', () => {
    const tabs = buildInspectorStyleSourceTabs({
      inspectorUIKit: 'tamagui',
      componentPath: 'src/Card.tsx',
      canInspectStyles: true,
    });

    expect(tabs.map((tab) => tab.id)).toEqual(['computed', 'tamagui:props']);
    expect(tabs[1]).toMatchObject({
      label: 'Props',
      cssSystem: 'tamagui',
      sourceForm: 'adapterKnownElementProp',
      filePath: 'src/Card.tsx',
    });
  });
});

describe('getExplicitStyleSourceTabId', () => {
  it('does not send Computed as an explicit write target', () => {
    expect(getExplicitStyleSourceTabId('computed')).toBeUndefined();
  });

  it('keeps concrete source tabs for write routing', () => {
    expect(getExplicitStyleSourceTabId('css-modules:card')).toBe('css-modules:card');
  });
});

describe('resolveInspectorStyleSourceTabs', () => {
  it('uses shared StyleReadManager tabs when available', () => {
    const tabs = resolveInspectorStyleSourceTabs({
      inspectorUIKit: 'tailwind',
      componentPath: 'src/Card.tsx',
      canInspectStyles: true,
      styleReadResult: {
        sourceTabs: [
          {
            id: 'computed',
            label: 'Computed',
            condition: { state: 'base' },
            confidence: 'computed-only',
          },
          {
            id: 'inline-style:style',
            label: 'Inline',
            cssSystem: 'inline-style',
            sourceForm: 'scriptReactStyleRule',
            condition: { state: 'base' },
            confidence: 'exact',
          },
        ],
      },
    });

    expect(tabs.map((tab) => tab.id)).toEqual(['computed', 'inline-style:style']);
  });

  it('falls back to inspector capability tabs before shared read data arrives', () => {
    const tabs = resolveInspectorStyleSourceTabs({
      inspectorUIKit: 'tailwind',
      componentPath: 'src/Card.tsx',
      canInspectStyles: true,
      styleReadResult: null,
    });

    expect(tabs.map((tab) => tab.id)).toEqual(['computed', 'tailwind-v4:elementClass']);
  });
});
