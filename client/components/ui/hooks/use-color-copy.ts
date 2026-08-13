/**
 * @file Cmd+C copy mode handler for color picker tooltip
 *
 * Accessed via: Internal hook, composed into useColorKeyboard
 * Assumptions: formatColorValues and matchHotkey available from color-tooltip module
 */

import { copyToClipboard, formatColorValues, matchHotkey } from '../color-tooltip';
import type { HoveredColorState } from '../color-utils';
import { isModifierPressed } from '../platform-keys';

export interface ColorCopyParams {
  hoveredColorRef: React.MutableRefObject<HoveredColorState | null>;
  copyModeRef: React.MutableRefObject<boolean>;
  setCopyMode: (mode: boolean) => void;
  copyModeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

/** Create a copy key handler. Pure function — no React hooks. */
export function createCopyKeyHandler(params: ColorCopyParams): (e: KeyboardEvent) => boolean {
  const { hoveredColorRef, copyModeRef, setCopyMode, copyModeTimerRef } = params;

  return (e: KeyboardEvent): boolean => {
    const hovered = hoveredColorRef.current;
    if (!hovered) return false;

    if (e.key === 'c' && isModifierPressed(e) && !copyModeRef.current) {
      const active = document.activeElement as HTMLInputElement | null;
      const tag = active?.tagName;
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && active.selectionStart !== active.selectionEnd) return false;
      e.preventDefault();
      e.stopPropagation();
      setCopyMode(true);
      copyModeTimerRef.current = setTimeout(() => setCopyMode(false), 2000);
      return true;
    }

    if (copyModeRef.current) {
      e.preventDefault();
      e.stopPropagation();
      const values = formatColorValues(hovered.tokenName, hovered.hex);
      const entry = values.find((v) => matchHotkey(e, v.hotkey));
      if (entry) {
        copyToClipboard(entry.value);
        setCopyMode(false);
      } else if (e.key === 'Escape') {
        setCopyMode(false);
      }
      return true;
    }

    return false;
  };
}

/**
 * Hook wrapper around createCopyKeyHandler.
 * Returns true if the event was consumed.
 */
export function useColorCopy(params: ColorCopyParams): {
  handleCopyKey: (e: KeyboardEvent) => boolean;
} {
  return { handleCopyKey: createCopyKeyHandler(params) };
}
