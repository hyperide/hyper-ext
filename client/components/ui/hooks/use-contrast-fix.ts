/**
 * @file Double-Ctrl contrast fix handler for token picker and hex modes
 *
 * Accessed via: Internal hook, composed into useColorKeyboard
 * Assumptions: popoverContentRef contains elements with data-color-value attributes
 *   (rendered by ColorPaletteGrid). Both files must maintain this contract.
 *
 * DOM coupling: Token picker mode queries popoverContentRef for
 * [data-color-value="${fix.value}"] to scroll and show tooltip.
 */

import { contrastRatio, findContrastFixHex, wcagLevel } from '@shared/utils/color';
import { useRef } from 'react';
import type { ColorOption, HoveredColorState, TokenSystem } from '../color-utils';
import { findNearestPassingColor } from '../color-utils';

export interface ContrastFixParams {
  colorOptions: ColorOption[];
  tokenSystem: TokenSystem;
  hoveredColorRef: React.MutableRefObject<HoveredColorState | null>;
  isLinkedRef: React.MutableRefObject<boolean>;
  currentHexRef: React.MutableRefObject<string>;
  effectiveContrastPairedRef: React.MutableRefObject<string | undefined>;
  popoverContentRef: React.RefObject<HTMLDivElement>;
  handleColorHover: (
    tokenName: string,
    hex: string,
    el: HTMLElement,
    sourceLabel?: string,
    pairedHex?: string,
    isTextColor?: boolean,
  ) => void;
  setFocusedValue: (value: string | null) => void;
  onChangeRef: React.MutableRefObject<(value: string) => void>;
  addRecentColorRef: React.MutableRefObject<(hex: string, token?: string) => void>;
}

/** Create a contrast key handler. Pure function — no React hooks. */
export function createContrastKeyHandler(
  params: ContrastFixParams,
  lastCtrlPressRef: { current: number },
  lastCtrlPressHexRef: { current: number },
): (e: KeyboardEvent) => boolean {
  const {
    colorOptions,
    tokenSystem,
    hoveredColorRef,
    isLinkedRef,
    currentHexRef,
    effectiveContrastPairedRef,
    popoverContentRef,
    handleColorHover,
    setFocusedValue,
    onChangeRef,
    addRecentColorRef,
  } = params;

  return (e: KeyboardEvent): boolean => {
    if (e.key !== 'Control' || e.repeat || e.shiftKey || e.altKey || e.metaKey) {
      return false;
    }

    const hovered = hoveredColorRef.current;

    // Token picker mode: hovered color with contrast pair
    if (hovered?.pairedHex) {
      const now = Date.now();
      if (now - lastCtrlPressRef.current < 400) {
        lastCtrlPressRef.current = 0;
        e.stopImmediatePropagation();
        const ratio = contrastRatio(hovered.hex, hovered.pairedHex);
        const level = wcagLevel(ratio);
        const targetLevel = level === 'Fail' ? 'AA' : level === 'AA' ? 'AAA' : null;
        if (targetLevel) {
          const hoveredOption = colorOptions.find((o) => o.hex.toLowerCase() === hovered.hex.toLowerCase());
          const fix = findNearestPassingColor(
            hovered.hex,
            hovered.pairedHex,
            colorOptions,
            targetLevel,
            hoveredOption?.colorName,
          );
          if (fix) {
            const el = popoverContentRef.current?.querySelector(
              `[data-color-value="${fix.value}"]`,
            ) as HTMLElement | null;
            if (el) {
              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              handleColorHover(
                tokenSystem === 'tamagui' ? `$${fix.value}` : fix.value,
                fix.hex,
                el,
                undefined,
                hovered.pairedHex,
                hovered.isTextColor,
              );
              setFocusedValue(fix.value);
            }
          }
        }
        return true;
      }
      lastCtrlPressRef.current = now;
      return false;
    }

    // Unlinked hex mode: fix via same-hue lightness adjustment
    if (!isLinkedRef.current && effectiveContrastPairedRef.current && currentHexRef.current?.startsWith('#')) {
      const now = Date.now();
      if (now - lastCtrlPressHexRef.current < 400) {
        lastCtrlPressHexRef.current = 0;
        e.stopImmediatePropagation(); // Prevent other picker instances from also firing
        const ratio = contrastRatio(currentHexRef.current, effectiveContrastPairedRef.current);
        const level = wcagLevel(ratio);
        const target = level === 'Fail' ? 'AA' : level === 'AA' ? 'AAA' : null;
        if (target) {
          const fix = findContrastFixHex(currentHexRef.current, effectiveContrastPairedRef.current, target);
          if (fix && fix !== currentHexRef.current) {
            onChangeRef.current(fix);
            addRecentColorRef.current(fix);
          }
        }
        return true;
      }
      lastCtrlPressHexRef.current = now;
    }

    return false;
  };
}

/**
 * Hook wrapper around createContrastKeyHandler.
 * Returns true if the event was consumed.
 */
export function useContrastFix(params: ContrastFixParams): {
  handleContrastKey: (e: KeyboardEvent) => boolean;
} {
  const lastCtrlPressRef = useRef<number>(0);
  const lastCtrlPressHexRef = useRef<number>(0);
  const handleContrastKey = createContrastKeyHandler(params, lastCtrlPressRef, lastCtrlPressHexRef);
  return { handleContrastKey };
}
