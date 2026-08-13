/**
 * @file Unit tests for the D2 multi-select source-tab merge (Auto chip + intersection-only override)
 *
 * Accessed via: RightSidebar derives the N>1 source-tab display row from per-element tab sets.
 * Architecture: docs/specs/2026-06-11-270-d2-source-routing.md §3
 */

import { describe, expect, it } from 'bun:test';
import type { StyleSourceTab } from '@lib/style-read/types';
import { AUTO_SOURCE_TAB_ID, mergeForMultiSelect } from '../source-tabs';

const BASE = { state: 'base' } as const;

function tailwindTab(cssClass = 'card'): StyleSourceTab {
  return {
    id: 'tailwind-v4:elementClass',
    label: 'Tailwind',
    cssSystem: 'tailwind-v4',
    sourceForm: 'elementClass',
    cssClass,
    condition: BASE,
    confidence: 'probable',
  };
}

function inlineTab(): StyleSourceTab {
  return { id: 'inline-style', label: 'Inline', cssSystem: 'inline-style', condition: BASE, confidence: 'probable' };
}

function cssModuleTab(filePath: string, classKey: string): StyleSourceTab {
  return {
    id: `css-modules:${classKey}`,
    label: 'CSS Module',
    cssSystem: 'css-modules',
    classKey,
    filePath,
    condition: BASE,
    confidence: 'probable',
  };
}

describe('mergeForMultiSelect', () => {
  it('always emits a default-selected Auto chip', () => {
    const tabs = mergeForMultiSelect([[tailwindTab()], [tailwindTab()]]);
    expect(tabs[0]).toMatchObject({ id: AUTO_SOURCE_TAB_ID, label: 'Auto', isDefault: true });
  });

  it('offers a concrete override when EVERY element shares exactly one concrete system', () => {
    const tabs = mergeForMultiSelect([[tailwindTab()], [tailwindTab()], [tailwindTab()]]);
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toMatchObject({ id: 'tailwind-v4:elementClass', label: 'Tailwind', cssSystem: 'tailwind-v4' });
  });

  it('renders ONLY Auto when the selection spans more than one concrete system', () => {
    const tabs = mergeForMultiSelect([[tailwindTab()], [inlineTab()]]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe(AUTO_SOURCE_TAB_ID);
  });

  it('renders ONLY Auto when one element has a system another lacks (no full intersection)', () => {
    // A is tailwind+inline, B is tailwind-only: A also owns inline that B does not → heterogeneous.
    const tabs = mergeForMultiSelect([[tailwindTab(), inlineTab()], [tailwindTab()]]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe(AUTO_SOURCE_TAB_ID);
  });

  it('offers a system-level CSS Modules override even across different module files (D4 × D5)', () => {
    // Both elements are css-modules, but in different files / class keys. The override is
    // system-level (id has no class suffix) so each element routes to its OWN owner.
    const tabs = mergeForMultiSelect([[cssModuleTab('a.module.css', 'card')], [cssModuleTab('b.module.css', 'panel')]]);
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toMatchObject({ id: 'css-modules', cssSystem: 'css-modules' });
    // The shared chip id must NOT encode one element's class key as a target.
    expect(tabs[1].id).not.toContain(':');
  });

  it('returns Auto-only for an empty / single-element-less selection', () => {
    expect(mergeForMultiSelect([])).toHaveLength(1);
    expect(mergeForMultiSelect([[], []])).toHaveLength(1);
  });
});
