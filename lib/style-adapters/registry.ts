/**
 * @file Style-adapter registry — the single source of truth for which CssSystemIds can be WRITTEN
 *
 * Spec §3.3 (Adapters — System B): writers register in default order
 * `[tailwindV4Adapter, cssModulesAdapter, tamaGuiAdapter, inlineStyleAdapter]`; "only four have a
 * working adapter (tailwind-v4 / css-modules / inline-style / tamagui). The other eight ... are
 * typed-but-unimplemented (PLANNED)" (D31: "styled-components & Emotion have no writer-adapter dirs
 * and no writer tests").
 *
 * User impact: the inspector's writable/readonly gate is DERIVED from this registry instead of a
 * hand-maintained list. Before this, emotion/styled-components were hard-listed as writable with no
 * adapter — an emotion edit silently polluted the user's file with a foreign inline `style={{}}`
 * write (it fell to the inline floor in the planner) and a styled-components edit dead-ended at the
 * executor's `unsupported()` no-op. Deriving "writable" from "a native writer is registered" makes
 * the gate honest: a system is editable in the inspector only when its adapter actually exists.
 *
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { cssModulesAdapter } from '@lib/style-adapters/css-modules';
import { inlineStyleAdapter } from '@lib/style-adapters/inline-style';
import { tailwindV4Adapter } from '@lib/style-adapters/tailwind-v4';
import { tamaGuiAdapter } from '@lib/style-adapters/tamagui';
import type { CssSystemId } from '@lib/style-read/types';
import type { FrameworkStyleAdapter } from '@lib/style-write/types';

/**
 * The universal inline-style fallback adapter id (spec §8.3 "Inline is a base-state floor, not a
 * universal floor"). Inline-style is the bottom-of-chain floor that every element can accept, so it
 * is EXCLUDED from the writer-backed set below: counting it would make every CssSystem report
 * "writable" via the floor, which is precisely the emotion bug this gate fixes.
 */
export const INLINE_FALLBACK_ADAPTER_ID: CssSystemId = 'inline-style';

/**
 * The default, immutable adapter registry (spec §3.3, default write order). This is the one list the
 * write manager AND the writable gate read from, so the two can never disagree about which systems
 * are editable.
 */
export const DEFAULT_STYLE_ADAPTERS: readonly FrameworkStyleAdapter[] = [
  tailwindV4Adapter,
  cssModulesAdapter,
  tamaGuiAdapter,
  inlineStyleAdapter,
];

/**
 * Derive the set of `CssSystemId`s that have a real NATIVE writer registered — the mechanical truth
 * behind "writable" (spec §3.3 TO-BE: "a system is writable only when its [adapter] ... exists").
 *
 * Ownership-collision rationale (this is a derivation across capability domains, spec §0.3 rule 3):
 * - cssFramework vs designSystem (§5.5): the registry keys adapters by `CssSystemId` (authoring
 *   channel), and a system counts as writable only if THAT id owns a writer — not because some
 *   sibling channel happens to be writable.
 * - inline floor (§8.3): the universal inline-style fallback is the base-state FLOOR, not a per-
 *   system native paradigm, so it is filtered out here. A system whose only available write path is
 *   the inline floor is NOT "natively writable"; reporting it writable is the emotion lie. Native
 *   writers today: tailwind-v4 (`elementClass`), css-modules (`cssStyleRule`), tamagui
 *   (`adapterKnownElementProp`).
 *
 * User impact: this set is what flips the inspector between full-edit and honest-readonly. Systems
 * absent from it (emotion, styled-components, mui-system, chakra-ui, mantine, vanilla-extract,
 * plain-css, tailwind-v3) render readonly until their adapters land, instead of corrupting the file.
 */
export function getWriterBackedCssSystemIds(
  adapters: readonly FrameworkStyleAdapter[] = DEFAULT_STYLE_ADAPTERS,
): Set<CssSystemId> {
  const writable = new Set<CssSystemId>();
  for (const adapter of adapters) {
    if (adapter.id === INLINE_FALLBACK_ADAPTER_ID) continue;
    if (adapter.writer) writable.add(adapter.id);
  }
  return writable;
}
