/**
 * @file Platform-aware modifier key detection
 *
 * Accessed via: Internal utility for keyboard shortcuts
 * Assumptions: runs in browser environment
 */

interface ModifierKey {
  /** KeyboardEvent.key value to match */
  key: 'Meta' | 'Control';
  /** Human-readable label */
  label: string;
  /** Symbol for UI display */
  symbol: string;
}

let cached: ModifierKey | null = null;

export function getModifierKey(): ModifierKey {
  if (cached) return cached;
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  cached = isMac ? { key: 'Meta', label: 'Cmd', symbol: '⌘' } : { key: 'Control', label: 'Ctrl', symbol: 'Ctrl' };
  return cached;
}

/** Check if the platform modifier (Cmd on Mac, Ctrl elsewhere) is held */
export function isModifierPressed(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  const mod = getModifierKey();
  return mod.key === 'Meta' ? e.metaKey : e.ctrlKey;
}
