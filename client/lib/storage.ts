/**
 * LocalStorage persistence utilities
 */

import type { LayoutStorage } from 'react-resizable-panels';

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
  // Logs panel
  isLogsPanelOpen: boolean;
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
  isLogsPanelOpen: false,
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
 * Canvas composition cache utilities
 * These cache canvas.json data from the server to localStorage for faster access
 */
