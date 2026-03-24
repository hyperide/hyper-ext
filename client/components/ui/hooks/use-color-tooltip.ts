/**
 * @file Tooltip state management for color picker hover interactions
 *
 * Accessed via: Internal hook, used by ColorCombobox wiring
 * Assumptions: popover content and info panel refs are stable across renders
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HoveredColorState } from '../color-utils';

export interface ColorTooltipState {
  hoveredColor: HoveredColorState | null;
  setHoveredColor: (color: HoveredColorState | null) => void;
  copyMode: boolean;
  setCopyMode: (mode: boolean) => void;
  focusedValue: string | null;
  setFocusedValue: (value: string | null) => void;
  handleColorHover: (
    tokenName: string,
    hex: string,
    el: HTMLElement,
    sourceLabel?: string,
    pairedHex?: string,
    isTextColor?: boolean,
  ) => void;
  handleColorLeave: () => void;
  popoverContentRef: React.RefObject<HTMLDivElement>;
  infoPanelRef: React.RefObject<HTMLDivElement>;
  /** Refs exposed for keyboard handlers (avoid deps churn) */
  focusedValueRef: React.MutableRefObject<string | null>;
  hoveredColorRef: React.MutableRefObject<HoveredColorState | null>;
  copyModeRef: React.MutableRefObject<boolean>;
  copyModeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  leaveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  lastCommandValueRef: React.MutableRefObject<string>;
  resetLastCommandValue: () => void;
}

export function useColorTooltip(): ColorTooltipState {
  const [hoveredColor, setHoveredColor] = useState<HoveredColorState | null>(null);
  const [copyMode, setCopyMode] = useState(false);
  const [focusedValue, setFocusedValue] = useState<string | null>(null);

  const focusedValueRef = useRef<string | null>(null);
  const hoveredColorRef = useRef<HoveredColorState | null>(null);
  hoveredColorRef.current = hoveredColor;
  const copyModeRef = useRef(copyMode);
  copyModeRef.current = copyMode;
  const copyModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverContentRef = useRef<HTMLDivElement>(null);
  const infoPanelRef = useRef<HTMLDivElement>(null);
  const lastCommandValueRef = useRef<string>('');

  // Keep ref in sync for use in callbacks without deps
  useEffect(() => {
    focusedValueRef.current = focusedValue;
  }, [focusedValue]);

  const handleColorHover = useCallback(
    (
      tokenName: string,
      hex: string,
      el: HTMLElement,
      sourceLabel?: string,
      pairedHex?: string,
      isTextColor?: boolean,
    ) => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      setHoveredColor({ tokenName, hex, sourceLabel, pairedHex, isTextColor, anchorRect: el.getBoundingClientRect() });
    },
    [],
  );

  const handleColorLeave = useCallback(() => {
    leaveTimerRef.current = setTimeout(() => {
      if (focusedValueRef.current) return; // Keep tooltip for contrast-fix focused color
      setHoveredColor(null);
      setCopyMode(false);
      if (copyModeTimerRef.current) {
        clearTimeout(copyModeTimerRef.current);
        copyModeTimerRef.current = null;
      }
    }, 80);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (copyModeTimerRef.current) clearTimeout(copyModeTimerRef.current);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  // Clamp info panel so its bottom doesn't go below Toolbar top
  useLayoutEffect(() => {
    const el = infoPanelRef.current;
    if (!el || !hoveredColor) return;
    const toolbarEl = document.querySelector('[data-testid="Toolbar"]');
    if (!toolbarEl) return;

    const panelRect = el.getBoundingClientRect();
    const toolbarTop = toolbarEl.getBoundingClientRect().top;

    if (panelRect.bottom > toolbarTop) {
      el.style.transform = 'none';
      el.style.top = `${toolbarTop - panelRect.height}px`;
    }
  }, [hoveredColor]);

  const resetLastCommandValue = useCallback(() => {
    lastCommandValueRef.current = '';
  }, []);

  return {
    hoveredColor,
    setHoveredColor,
    copyMode,
    setCopyMode,
    focusedValue,
    setFocusedValue,
    handleColorHover,
    handleColorLeave,
    popoverContentRef,
    infoPanelRef,
    focusedValueRef,
    hoveredColorRef,
    copyModeRef,
    copyModeTimerRef,
    leaveTimerRef,
    lastCommandValueRef,
    resetLastCommandValue,
  };
}
