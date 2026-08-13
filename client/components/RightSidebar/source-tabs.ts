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

/**
 * Net-new id for the multi-select "Auto" intent chip. Treated like 'computed' for write
 * purposes (no explicit target → per-element edit-in-place). D2 spec §3.
 */
export const AUTO_SOURCE_TAB_ID = 'auto';

/** A concrete (writable) CSS system a selected element owns. 'computed' is not concrete. */
function concreteTabs(tabs: StyleSourceTab[]): StyleSourceTab[] {
  return tabs.filter((tab) => tab.id !== 'computed' && tab.confidence !== 'computed-only' && Boolean(tab.cssSystem));
}

/**
 * Build the N>1 source-tab DISPLAY row from each selected element's own tab set.
 *
 * Always returns an Auto chip (default-selected). Adds exactly ONE concrete override chip
 * iff EVERY selected element shares exactly one concrete CSS system and none owns a DIFFERENT
 * concrete system (full intersection). A heterogeneous selection returns Auto only.
 *
 * For css-modules the override is SYSTEM-LEVEL (id `'css-modules'`, no class suffix): the chip
 * never encodes one element's class key as a shared target. Each element resolves to its OWN
 * module file + class via per-element routing (D2 spec §3 cross-file × D5 named-fix). Tailwind /
 * inline / props overrides carry their normal system-level id.
 *
 * Pure — no hooks, no IO. The union is kept internally only to compute the intersection; partial
 * coverage chips are never exposed (D2-b rejected).
 */
export function mergeForMultiSelect(perElementTabs: StyleSourceTab[][]): StyleSourceTab[] {
  const auto: StyleSourceTab = {
    id: AUTO_SOURCE_TAB_ID,
    label: 'Auto',
    condition: BASE_CONDITION,
    confidence: 'computed-only',
    isDefault: true,
  };

  if (perElementTabs.length === 0) return [auto];

  // Each element's set of concrete systems (by cssSystem identity — value-bearing, not raw id).
  const perElementSystems = perElementTabs.map(
    (tabs) => new Set(concreteTabs(tabs).map((tab) => tab.cssSystem as string)),
  );

  // A full-intersection override exists only when every element owns EXACTLY one concrete system
  // and they are all the same system. If any element owns >1 concrete system, or systems differ,
  // a single concrete chip would mis-route for some element → collapse to Auto only.
  if (perElementSystems.some((set) => set.size !== 1)) return [auto];

  const firstSystem = [...perElementSystems[0]][0];
  const homogeneous = perElementSystems.every((set) => set.has(firstSystem) && set.size === 1);
  if (!homogeneous) return [auto];

  // Representative concrete tab for the shared system (first element that owns it).
  const sharedTab = perElementTabs.flatMap((tabs) => concreteTabs(tabs)).find((tab) => tab.cssSystem === firstSystem);
  if (!sharedTab) return [auto];

  const override: StyleSourceTab =
    firstSystem === 'css-modules'
      ? // System-level override: route to each element's OWN css-modules owner. No class suffix.
        {
          id: 'css-modules',
          label: 'CSS Modules',
          cssSystem: 'css-modules',
          condition: BASE_CONDITION,
          confidence: 'probable',
        }
      : { ...sharedTab, isDefault: false };

  return [auto, override];
}
