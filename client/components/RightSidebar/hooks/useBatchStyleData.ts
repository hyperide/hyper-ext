/**
 * @file Merges per-element parsed styles for the multi-select inspector
 *
 * Accessed via: RightSidebar multi-select render path
 * Assumptions: callers read each selected element's ParsedStyles, then merge here.
 *   A property shared by every element keeps its value; any divergence (including
 *   present-vs-absent) collapses to MIXED so the inspector can show a placeholder.
 */

import type { ParsedStyles } from '@/lib/canvas-engine/adapters/types';

export const MIXED = '__mixed__' as const;
type MixedValue = typeof MIXED;

export type MergedStyles = {
  [K in keyof ParsedStyles]?: ParsedStyles[K] | MixedValue;
};

/**
 * Merges multiple ParsedStyles into one, marking differing values as MIXED.
 * Pure function — no hooks, no side effects.
 */
export function mergeStyleData(allStyles: Partial<ParsedStyles>[]): MergedStyles {
  if (allStyles.length === 0) return {};
  if (allStyles.length === 1) return { ...allStyles[0] };

  const keys = new Set<string>();
  for (const s of allStyles) {
    for (const k of Object.keys(s)) {
      if (s[k as keyof ParsedStyles] !== undefined) keys.add(k);
    }
  }

  const merged: MergedStyles = {};
  for (const key of keys) {
    const k = key as keyof ParsedStyles;
    const first = allStyles[0][k];
    const allSame = allStyles.every((s) => {
      const val = s[k];
      if (val === undefined && first === undefined) return true;
      if (val === undefined || first === undefined) return false;
      if (typeof first === 'object' && first !== null) {
        return JSON.stringify(val) === JSON.stringify(first);
      }
      return val === first;
    });
    (merged as Record<string, unknown>)[key] = allSame ? first : MIXED;
  }

  return merged;
}
