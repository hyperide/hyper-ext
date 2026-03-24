/**
 * @file Hook to manage recently used colors in localStorage
 *
 * Accessed via: Internal hook, used by ColorCombobox
 * Assumptions: localStorage available (SaaS and VS Code webview)
 */

import { useCallback, useSyncExternalStore } from 'react';

export const STORAGE_KEY = 'color-picker-recent';
export const MAX_RECENT = 6;

export interface RecentColor {
  hex: string;
  token?: string;
}

let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Cached snapshot — only re-parsed when raw string changes */
let cachedRaw: string | null = null;
let cachedParsed: RecentColor[] = [];
const EMPTY: RecentColor[] = [];

export function getSnapshot(): RecentColor[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedParsed;
    cachedRaw = raw;
    cachedParsed = raw ? JSON.parse(raw) : EMPTY;
    return cachedParsed;
  } catch {
    return EMPTY;
  }
}

export function addColor(hex: string, token?: string) {
  const normalized = hex.toLowerCase();
  const current = getSnapshot();
  const filtered = current.filter((c) => c.hex.toLowerCase() !== normalized);
  const updated = [{ hex: normalized, token }, ...filtered].slice(0, MAX_RECENT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  emitChange();
}

export function useRecentColors() {
  const colors = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  const addRecentColor = useCallback((hex: string, token?: string) => {
    addColor(hex, token);
  }, []);

  return { recentColors: colors, addRecentColor };
}
