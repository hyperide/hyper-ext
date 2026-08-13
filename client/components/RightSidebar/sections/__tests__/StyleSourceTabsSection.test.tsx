/**
 * @file StyleSourceTabsSection tests for source-tab selection UI
 *
 * Accessed via: bun test client/components/RightSidebar/sections/__tests__/StyleSourceTabsSection.test.tsx
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it } from 'bun:test';
import type { StyleSourceTab } from '@lib/style-read/types';
import { fireEvent, render } from '@testing-library/react';
import { AUTO_SOURCE_TAB_ID, mergeForMultiSelect } from '../../source-tabs';
import { StyleSourceTabsSection } from '../StyleSourceTabsSection';

const tailwindTab: StyleSourceTab = {
  id: 'tailwind-v4:elementClass',
  label: 'Tailwind',
  cssSystem: 'tailwind-v4',
  sourceForm: 'elementClass',
  condition: { state: 'base' },
  confidence: 'probable',
};
const inlineTab: StyleSourceTab = {
  id: 'inline-style',
  label: 'Inline',
  cssSystem: 'inline-style',
  condition: { state: 'base' },
  confidence: 'probable',
};

const tabs: StyleSourceTab[] = [
  {
    id: 'computed',
    label: 'Computed',
    condition: { state: 'base' },
    confidence: 'computed-only',
    isDefault: true,
  },
  {
    id: 'css-modules:card',
    label: '.card',
    cssSystem: 'css-modules',
    sourceForm: 'cssStyleRule',
    cssSyntax: 'css',
    filePath: 'src/Card.module.css',
    selector: '.card',
    condition: { state: 'base' },
    confidence: 'exact',
  },
];

describe('StyleSourceTabsSection', () => {
  it('renders computed and concrete source tabs', () => {
    const { getByRole } = render(
      <StyleSourceTabsSection tabs={tabs} selectedTabId="computed" onSourceTabChange={() => {}} />,
    );

    expect(getByRole('button', { name: 'Computed' })).toBeTruthy();
    expect(getByRole('button', { name: '.card' })).toBeTruthy();
  });

  it('marks selected tab with aria-pressed', () => {
    const { getByRole } = render(
      <StyleSourceTabsSection tabs={tabs} selectedTabId="css-modules:card" onSourceTabChange={() => {}} />,
    );

    expect(getByRole('button', { name: '.card' }).getAttribute('aria-pressed')).toBe('true');
    expect(getByRole('button', { name: 'Computed' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('notifies when a source tab is selected', () => {
    const selected: string[] = [];
    const { getByRole } = render(
      <StyleSourceTabsSection
        tabs={tabs}
        selectedTabId="computed"
        onSourceTabChange={(tabId) => selected.push(tabId)}
      />,
    );

    fireEvent.click(getByRole('button', { name: '.card' }));

    expect(selected).toEqual(['css-modules:card']);
  });

  describe('multi-select (D2 §3) — mergeForMultiSelect → render pipeline', () => {
    it('renders Auto + the concrete override for a homogeneous all-Tailwind selection', () => {
      const merged = mergeForMultiSelect([[tailwindTab], [tailwindTab], [tailwindTab]]);
      const { getByRole } = render(
        <StyleSourceTabsSection tabs={merged} selectedTabId={AUTO_SOURCE_TAB_ID} onSourceTabChange={() => {}} />,
      );

      expect(getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true');
      expect(getByRole('button', { name: 'Tailwind' })).toBeTruthy();
    });

    it('renders ONLY Auto for a heterogeneous selection (override withheld)', () => {
      const merged = mergeForMultiSelect([[tailwindTab], [inlineTab]]);
      const { getByRole, queryByRole } = render(
        <StyleSourceTabsSection tabs={merged} selectedTabId={AUTO_SOURCE_TAB_ID} onSourceTabChange={() => {}} />,
      );

      expect(getByRole('button', { name: 'Auto' })).toBeTruthy();
      expect(queryByRole('button', { name: 'Tailwind' })).toBeNull();
      expect(queryByRole('button', { name: 'Inline' })).toBeNull();
    });
  });
});
