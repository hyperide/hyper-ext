/**
 * LocalStorage persistence utilities
 */

import type { LayoutStorage } from 'react-resizable-panels';
import type { CanvasComposition, CanvasMode } from '../../shared/types/canvas';

/**
 * LayoutStorage adapter for react-resizable-panels persistence.
 * Wraps localStorage with error safety (matches existing pattern).
 */
export const panelLayoutStorage: LayoutStorage = {
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore quota errors
    }
  },
};

const STORAGE_KEY = 'hyper-canvas-state';
const CANVAS_COMPOSITION_KEY = 'hyper-canvas-compositions';

export interface PersistedState {
  mode: 'board' | 'design' | 'interact' | 'code';
  projectId: string | null;
  openedComponent: string | null; // Component path for board/design/interact modes
  openFiles: string[]; // File paths for code mode
  activeFilePath: string | null; // Active file in code mode
  activeInstanceId: string | null; // Active instance in design mode (for multi-instance)
  // Split view settings
  splitViewEnabled: boolean;
  splitOrientation: 'horizontal' | 'vertical';
  // AI Chat settings
  isAIChatDocked: boolean;
  aiChatSidebarWidth: number;
  // Left sidebar width
  leftSidebarWidth: number;
}

const DEFAULT_STATE: PersistedState = {
  mode: 'board',
  projectId: null,
  openedComponent: null,
  openFiles: [],
  activeFilePath: null,
  activeInstanceId: null,
  splitViewEnabled: false,
  splitOrientation: 'horizontal',
  isAIChatDocked: false,
  aiChatSidebarWidth: 400,
  leftSidebarWidth: 280,
};

/**
 * Load state from localStorage
 */
export function loadPersistedState(): PersistedState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_STATE;

    const parsed = JSON.parse(stored) as PersistedState;
    return { ...DEFAULT_STATE, ...parsed };
  } catch (error) {
    console.error('[Storage] Failed to load state:', error);
    return DEFAULT_STATE;
  }
}

/**
 * Save state to localStorage
 */
export function savePersistedState(state: Partial<PersistedState>): void {
  try {
    const current = loadPersistedState();
    const updated = { ...current, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('[Storage] Failed to save state:', error);
  }
}

/**
 * Reset all state except project when project changes
 */
export function resetStateForProject(projectId: string | null): void {
  savePersistedState({
    projectId,
    openedComponent: null,
    openFiles: [],
    activeFilePath: null,
  });
}

/**
 * Clear all persisted state
 */
export function clearPersistedState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[Storage] Failed to clear state:', error);
  }
}

/**
 * Canvas composition cache utilities
 * These cache canvas.json data from the server to localStorage for faster access
 */

/**
 * Build cache key for canvas composition
 */
function getCanvasCompositionCacheKey(projectId: string, componentPath: string): string {
  return `${CANVAS_COMPOSITION_KEY}:${projectId}:${componentPath}`;
}

/**
 * Get cached canvas composition from localStorage
 */
export function getCanvasComposition(projectId: string, componentPath: string): CanvasComposition | null {
  try {
    const key = getCanvasCompositionCacheKey(projectId, componentPath);
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    return JSON.parse(cached) as CanvasComposition;
  } catch (error) {
    console.error('[Storage] Failed to get canvas composition:', error);
    return null;
  }
}

/**
 * Save canvas composition to localStorage cache
 */
export function saveCanvasComposition(projectId: string, componentPath: string, composition: CanvasComposition): void {
  try {
    const key = getCanvasCompositionCacheKey(projectId, componentPath);
    localStorage.setItem(key, JSON.stringify(composition));
  } catch (error) {
    console.error('[Storage] Failed to save canvas composition:', error);
  }
}

/**
 * Get canvas mode based on composition state
 * If composition exists and has instances, mode is 'multi', otherwise 'single'
 */
export function getCanvasMode(projectId: string, componentPath: string): CanvasMode {
  const composition = getCanvasComposition(projectId, componentPath);
  if (!composition) return 'single';

  const hasInstances = Object.keys(composition.instances).length > 0;
  return hasInstances ? 'multi' : 'single';
}

/**
 * Clear canvas composition cache for a component
 */
export function clearCanvasComposition(projectId: string, componentPath: string): void {
  try {
    const key = getCanvasCompositionCacheKey(projectId, componentPath);
    localStorage.removeItem(key);
  } catch (error) {
    console.error('[Storage] Failed to clear canvas composition:', error);
  }
}

/**
 * Clear all canvas composition cache for a project
 */
export function clearProjectCanvasCompositions(projectId: string): void {
  try {
    const prefix = `${CANVAS_COMPOSITION_KEY}:${projectId}:`;
    const keysToRemove: string[] = [];

    // Find all keys with this project prefix
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    // Remove all matching keys
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.error('[Storage] Failed to clear project compositions:', error);
  }
}
