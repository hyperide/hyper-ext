import { useCallback, useEffect, useState } from 'react';
import { loadPersistedState } from '@/lib/storage';
import { type ComponentsAPIResponse, fetchComponentsJSON } from '@/utils/fetchComponents';

export interface ComponentInfo {
  name: string;
  path: string;
}

interface AvailableComponents {
  atoms: ComponentInfo[];
  composites: ComponentInfo[];
  isLoaded: boolean;
}

interface UseComponentAutoLoadOptions {
  activeProjectId: string | undefined;
  activeProjectStatus: string | undefined;
  currentComponentName: string | undefined;
  mode: 'design' | 'interact' | 'code';
  loadComponent: (path: string) => void;
}

/** Entry point files that should not be used as displayable components */
const ENTRY_POINT_NAMES = ['main', 'index', '_app'];

export function isEntryPoint(name: string): boolean {
  const baseName = name.toLowerCase().replace(/\.(tsx|ts|jsx|js)$/, '');
  return ENTRY_POINT_NAMES.includes(baseName);
}

/** Flatten grouped API response into flat arrays. Returns null on server error. */
export function flattenComponentGroups(
  data: ComponentsAPIResponse,
): { atoms: ComponentInfo[]; composites: ComponentInfo[] } | null {
  if (!data.success) return null;
  return {
    atoms: data.atomGroups?.flatMap((g) => g.components) || [],
    composites: data.compositeGroups?.flatMap((g) => g.components) || [],
  };
}

/** Determine which component to auto-load. Returns path or null. */
export function selectComponentToLoad(opts: {
  atoms: ComponentInfo[];
  composites: ComponentInfo[];
  currentComponentName: string | undefined;
  mode: 'design' | 'interact' | 'code';
  persistedOpenedComponent: string | undefined;
}): string | null {
  const { atoms, composites, currentComponentName, mode, persistedOpenedComponent } = opts;

  // Try to restore previously opened component
  if (persistedOpenedComponent && !currentComponentName) {
    const all = [...atoms, ...composites];
    const found = all.find((c) => c.path === persistedOpenedComponent);
    if (found) return found.path;
  }

  // Skip auto-select in code mode
  if (mode === 'code') return null;

  const currentIsEntryPoint = currentComponentName && isEntryPoint(currentComponentName);
  if (currentComponentName && !currentIsEntryPoint) return null;

  return composites[0]?.path ?? atoms[0]?.path ?? null;
}

/**
 * Loads available components when project becomes active.
 * Auto-selects first component or restores previously opened one.
 */
export function useComponentAutoLoad({
  activeProjectId,
  activeProjectStatus,
  currentComponentName,
  mode,
  loadComponent,
}: UseComponentAutoLoadOptions): AvailableComponents {
  const [availableComponents, setAvailableComponents] = useState<AvailableComponents>({
    atoms: [],
    composites: [],
    isLoaded: false,
  });

  const fetchAndAutoSelect = useCallback(async () => {
    try {
      const data = await fetchComponentsJSON();
      const flattened = flattenComponentGroups(data);
      if (!flattened) {
        // HTTP error (!res.ok) returns { success: false } — mark as loaded,
        // retrying won't help (infrastructure issue).
        // Business error (e.g. "No active project") — DON'T mark as loaded,
        // next project-activated/components_updated event will retry.
        const isHttpError = typeof data.error === 'string' && data.error.startsWith('HTTP ');
        if (isHttpError) {
          console.log('[useComponentAutoLoad] Failed to load components:', data.error);
          setAvailableComponents({ atoms: [], composites: [], isLoaded: true });
        } else {
          console.warn('[useComponentAutoLoad] Server error:', data.error);
        }
        return;
      }

      const { atoms, composites } = flattened;
      console.log('[useComponentAutoLoad] Available components:', data);
      setAvailableComponents({ atoms, composites, isLoaded: true });

      const persistedState = loadPersistedState();
      const selectedPath = selectComponentToLoad({
        atoms,
        composites,
        currentComponentName,
        mode,
        persistedOpenedComponent: persistedState.openedComponent,
      });

      if (selectedPath) {
        console.log('[useComponentAutoLoad] Loading component:', selectedPath);
        loadComponent(selectedPath);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Failed to load components:', err);
      setAvailableComponents({ atoms: [], composites: [], isLoaded: true });
    }
  }, [currentComponentName, mode, loadComponent]);

  useEffect(() => {
    if (!activeProjectId || activeProjectStatus !== 'running') return;

    // Reset loaded state when starting a new fetch
    setAvailableComponents((prev) => ({ ...prev, isLoaded: false }));
    fetchAndAutoSelect();
  }, [activeProjectId, activeProjectStatus, fetchAndAutoSelect]);

  // Retry on components_updated if initial fetch returned empty results
  useEffect(() => {
    if (!activeProjectId || activeProjectStatus !== 'running') return;
    if (!availableComponents.isLoaded) return;
    if (availableComponents.atoms.length > 0 || availableComponents.composites.length > 0) return;

    const handleRetry = () => {
      console.log('[useComponentAutoLoad] Retrying after components_updated (previous result was empty)');
      fetchAndAutoSelect();
    };
    window.addEventListener('components_updated', handleRetry, { once: true });
    return () => window.removeEventListener('components_updated', handleRetry);
  }, [activeProjectId, activeProjectStatus, availableComponents, fetchAndAutoSelect]);

  return availableComponents;
}
