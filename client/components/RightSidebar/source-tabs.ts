/**
 * @file Source-tab helpers for inspector write target selection
 *
 * Accessed via: Right sidebar inspector when an element is selected
 * Assumptions: callers provide top-level inspector capabilities; class-level
 * selector ownership comes from StyleReadResult when available.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import type { StyleReadResult, StyleSourceTab } from '@lib/style-read/types';
import type { UIKitType } from './types';

interface InspectorStyleSourceTabsInput {
  inspectorUIKit: UIKitType;
  componentPath: string | null;
  canInspectStyles: boolean;
}

interface ResolveInspectorStyleSourceTabsInput extends InspectorStyleSourceTabsInput {
  styleReadResult?: Pick<StyleReadResult, 'sourceTabs'> | null;
}

const BASE_CONDITION = { state: 'base' } as const;

export function buildInspectorStyleSourceTabs(input: InspectorStyleSourceTabsInput): StyleSourceTab[] {
  const tabs: StyleSourceTab[] = [
    {
      id: 'computed',
      label: 'Computed',
      condition: BASE_CONDITION,
      confidence: 'computed-only',
      isDefault: true,
    },
  ];

  if (!input.canInspectStyles) {
    return tabs;
  }

  if (input.inspectorUIKit === 'tailwind') {
    tabs.push({
      id: 'tailwind-v4:elementClass',
      label: 'Tailwind',
      cssSystem: 'tailwind-v4',
      sourceForm: 'elementClass',
      filePath: input.componentPath ?? undefined,
      condition: BASE_CONDITION,
      confidence: 'probable',
    });
  }

  if (input.inspectorUIKit === 'tamagui') {
    tabs.push({
      id: 'tamagui:props',
      label: 'Props',
      cssSystem: 'tamagui',
      sourceForm: 'adapterKnownElementProp',
      filePath: input.componentPath ?? undefined,
      condition: BASE_CONDITION,
      confidence: 'probable',
    });
  }

  return tabs;
}

export function resolveInspectorStyleSourceTabs(input: ResolveInspectorStyleSourceTabsInput): StyleSourceTab[] {
  if (input.styleReadResult?.sourceTabs && input.styleReadResult.sourceTabs.length > 0) {
    return input.styleReadResult.sourceTabs;
  }

  return buildInspectorStyleSourceTabs(input);
}

export function getExplicitStyleSourceTabId(tabId: string): string | undefined {
  return tabId === 'computed' ? undefined : tabId;
}
