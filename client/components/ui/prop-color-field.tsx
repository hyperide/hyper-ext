/**
 * @file PropColorField — token-aware color control for color-category prop fields.
 *
 * Accessed via: Props editor (PropsFormField) when a prop's tokenCategory is 'color'.
 *
 * Assumptions:
 *   - The project's UI kit decides the emit form. tamagui → `$token`, tailwind →
 *     class/value (hex), 'none' → RAW HEX (we never fabricate tailwind tokens for a
 *     project with no kit).
 *   - The token round-trip (token↔hex, no silent conversion, nearest-token snap only on
 *     explicit link-toggle) lives in ColorCombobox / use-color-value — reused here, not
 *     reimplemented.
 *   - onChange is the caller's prop write path (PropsEditor.syncPropToFile →
 *     engine.updateASTProp): one undo step, format-preserving.
 *
 * Known limitation (pre-existing, SaaS-wide — NOT introduced here): the SaaS client
 * never calls setTamaguiPalette(), so ColorCombobox resolves only the built-in Radix
 * Tamagui palette, not a project's CUSTOM color tokens (e.g. `$brand9`). A custom token
 * is still PRESERVED verbatim (no silent token→hex rewrite — it only changes if the user
 * explicitly picks another color), but it is not offered as a selectable swatch and shows
 * no resolved hex. This matches FillSection, which already uses ColorCombobox for tamagui
 * projects with the same gap — so Variant A is parity, not a regression. Loading the
 * project palette into the SaaS client (the ext-only loadTamaguiPalette →
 * setTamaguiPalette flow, HYP-288) is the proper fix and is tracked separately.
 */

import type { CanvasEngine } from '@/lib/canvas-engine/core/CanvasEngine';
import type { UiKitLabel } from '@lib/ui-kit';
import { ColorCombobox } from './color-combobox';

/** Project UI kit — alias of the shared `UiKitLabel` union (HYP-984), same as RightSidebar's `UIKitType`. */
export type PropColorUIKit = UiKitLabel;

interface PropColorFieldProps {
  /** Prop name (used for the accessible field id). */
  name: string;
  /** Current prop value: a `$token`, a hex string, or empty. */
  value: string;
  /** Project UI kit — selects token system or raw-hex mode. */
  uiKit: PropColorUIKit;
  /** Write the new value back to the source AST (one undo step, format-preserving). */
  onChange: (value: string) => void;
  /** Canvas engine — enables in-component color awareness (optional). */
  engine?: CanvasEngine | null;
  /** Source file of the selected component (optional). */
  componentPath?: string | null;
  fieldId?: string;
  testId?: string;
}

export function PropColorField({
  name,
  value,
  uiKit,
  onChange,
  engine,
  componentPath,
  fieldId,
  testId,
}: PropColorFieldProps) {
  const id = fieldId ?? `prop-color-${name}`;

  // Project with no UI kit: a RAW HEX field. We deliberately do NOT route through the
  // token combobox here — there are no tokens to offer, and snapping to a fabricated
  // tailwind palette would lie about the project. Raw hex, written verbatim, no snap.
  if (uiKit === 'none') {
    return (
      <div className="w-full h-6 px-2 bg-gray-100 rounded flex items-center">
        <input
          id={id}
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          {...(testId != null ? { 'data-testid': testId } : {})}
          className="h-auto border-0 bg-transparent !text-[11px] text-gray-800 p-0 focus-visible:outline-none flex-1"
        />
      </div>
    );
  }

  // tamagui → emit `$token`; tailwind → emit class/value (hex). The round-trip and the
  // "no silent token→hex" guarantee are owned by ColorCombobox / use-color-value.
  return (
    <ColorCombobox
      value={value ?? ''}
      onChange={onChange}
      tokenSystem={uiKit === 'tamagui' ? 'tamagui' : 'tailwind'}
      inputPlaceholder="none"
      className="flex-1"
      engine={engine}
      componentPath={componentPath}
      testId={testId}
      inputTestId={id}
    />
  );
}
