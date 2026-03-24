/**
 * @file Color value lifecycle management for linked (token) and unlinked (hex) modes
 *
 * Accessed via: Internal hook, used by ColorCombobox wiring
 * Assumptions: tokenSystem determines how values are resolved and emitted
 */

import { getTamaguiColorHex } from '@lib/tamagui/values';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findClosestColor,
  getHexFromToken,
  getTokenFromHex,
  SPECIAL_CSS_VALUES,
  type TokenSystem,
} from '../color-utils';

/** Normalize user hex input: add # prefix, validate format. Returns null if invalid. */
export function normalizeHexInput(input: string): string | null {
  let hex = input.trim();
  if (!hex.startsWith('#') && hex.length > 0) {
    hex = `#${hex}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(hex) || /^#[0-9a-fA-F]{3}$/.test(hex)) return hex;
  if (hex === '' || hex === '#') return '';
  return null;
}

/** Resolve what onChange should receive when a token is selected. Pure function. */
export function resolveTokenSelection(token: string, tokenSystem: TokenSystem): { value: string; hex: string | null } {
  if (token === 'none') return { value: '', hex: null };
  if (SPECIAL_CSS_VALUES.has(token)) return { value: token, hex: null };
  const hex = getHexFromToken(token, tokenSystem);
  if (!hex) return { value: token, hex: null };
  const emitValue = tokenSystem === 'tamagui' ? `$${token}` : hex;
  return { value: emitValue, hex };
}

export interface ColorValueState {
  isLinked: boolean;
  currentHex: string;
  currentToken: string | null;
  handleSelect: (token: string) => void;
  handleUnlinkToggle: () => void;
  handleHexInput: (value: string) => void;
  /** Refs for keyboard handlers (avoid deps churn) */
  currentHexRef: React.MutableRefObject<string>;
  isLinkedRef: React.MutableRefObject<boolean>;
}

export function useColorValue(
  value: string,
  tokenSystem: TokenSystem,
  controlledIsUnlinked: boolean | undefined,
  onChange: (value: string) => void,
  addRecentColor: (hex: string, token?: string) => void,
): ColorValueState {
  // Linked mode: true = use tokens, false = arbitrary hex
  const [internalIsLinked, setInternalIsLinked] = useState(() => {
    if (!value) return true;
    if (tokenSystem === 'tamagui' && value.startsWith('$')) return true;
    return !!getTokenFromHex(value, tokenSystem);
  });

  // Sync linked mode when value changes externally
  useEffect(() => {
    if (controlledIsUnlinked !== undefined) return;
    if (!value) return;
    if (value.startsWith('#')) {
      const hasToken = !!getTokenFromHex(value, tokenSystem);
      setInternalIsLinked(hasToken);
    } else if (tokenSystem === 'tamagui' && value.startsWith('$')) {
      setInternalIsLinked(true);
    }
  }, [value, tokenSystem, controlledIsUnlinked]);

  const isLinked = controlledIsUnlinked !== undefined ? !controlledIsUnlinked : internalIsLinked;

  // Get current hex value (convert token to hex if needed)
  const currentHex = useMemo(() => {
    if (!value) return '';
    if (value.startsWith('#')) return value;
    if (tokenSystem === 'tamagui' && value.startsWith('$')) {
      return getTamaguiColorHex(value) || value;
    }
    return getHexFromToken(value, tokenSystem) || value;
  }, [value, tokenSystem]);

  // Find current token from value
  const currentToken = useMemo(() => {
    if (!value) return null;
    if (tokenSystem === 'tamagui' && value.startsWith('$')) {
      return value.slice(1);
    }
    return getTokenFromHex(value.startsWith('#') ? value : currentHex, tokenSystem);
  }, [value, currentHex, tokenSystem]);

  // Refs for global keydown handler (avoid deps churn)
  const currentHexRef = useRef(currentHex);
  currentHexRef.current = currentHex;
  const isLinkedRef = useRef(isLinked);
  isLinkedRef.current = isLinked;

  const handleSelect = useCallback(
    (token: string) => {
      const result = resolveTokenSelection(token, tokenSystem);
      onChange(result.value);
      if (result.hex) addRecentColor(result.hex, token);
    },
    [tokenSystem, onChange, addRecentColor],
  );

  const handleUnlinkToggle = useCallback(() => {
    if (isLinked) {
      setInternalIsLinked(false);
      if (currentHex) {
        onChange(currentHex);
      }
    } else {
      if (currentHex) {
        const closest = findClosestColor(currentHex, tokenSystem);
        if (closest) {
          if (tokenSystem === 'tamagui') {
            onChange(`$${closest.token}`);
          } else {
            onChange(closest.hex);
          }
        }
      }
      setInternalIsLinked(true);
    }
  }, [isLinked, currentHex, tokenSystem, onChange]);

  const handleHexInput = useCallback(
    (inputValue: string) => {
      const hex = normalizeHexInput(inputValue);
      if (hex === null) return; // Invalid format
      onChange(hex);
      if (hex.startsWith('#')) addRecentColor(hex);
    },
    [onChange, addRecentColor],
  );

  return {
    isLinked,
    currentHex,
    currentToken,
    handleSelect,
    handleUnlinkToggle,
    handleHexInput,
    currentHexRef,
    isLinkedRef,
  };
}
