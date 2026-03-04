import { useEffect, useState } from 'react';
import { loadPersistedState } from '@/lib/storage';
import { authFetch } from '@/utils/authFetch';

interface ComponentInfo {
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

  useEffect(() => {
    if (!activeProjectId || activeProjectStatus !== 'running') return;

    // Reset loaded state when starting a new fetch
    setAvailableComponents((prev) => ({ ...prev, isLoaded: false }));

    const loadComponents = async () => {
      try {
        const res = await authFetch('/api/get-components');
        if (!res.ok) {
          console.log('[useComponentAutoLoad] Failed to load components');
          setAvailableComponents({ atoms: [], composites: [], isLoaded: true });
          return;
        }

        const data = await res.json();
        console.log('[useComponentAutoLoad] Available components:', data);

        // Flatten grouped components into flat arrays
        const atoms = data.atomGroups?.flatMap((group: { components: ComponentInfo[] }) => group.components) || [];
        const composites =
          data.compositeGroups?.flatMap((group: { components: ComponentInfo[] }) => group.components) || [];

        setAvailableComponents({ atoms, composites, isLoaded: true });

        // Entry point files that should not be used as displayable components
        const entryPointNames = ['main', 'index', '_app'];
        const isEntryPoint = (name: string) => {
          const baseName = name.toLowerCase().replace(/\.(tsx|ts|jsx|js)$/, '');
          return entryPointNames.includes(baseName);
        };

        // Try to restore previously opened component first
        const persistedState = loadPersistedState();
        let componentLoaded = false;

        if (persistedState.openedComponent && !currentComponentName) {
          // Try to find and load the persisted component
          const allComponents = [...atoms, ...composites];
          const persistedComponent = allComponents.find((comp) => comp.path === persistedState.openedComponent);

          if (persistedComponent) {
            console.log('[useComponentAutoLoad] Restoring previously opened component:', persistedComponent.name);
            loadComponent(persistedComponent.path);
            componentLoaded = true;
          }
        }

        // Auto-select first available component if no component is loaded OR if current is an entry point
        // Skip auto-select in code mode — code editor doesn't need a visual component loaded
        if (!componentLoaded && mode !== 'code') {
          const currentIsEntryPoint = currentComponentName && isEntryPoint(currentComponentName);

          if (!currentComponentName || currentIsEntryPoint) {
            if (currentIsEntryPoint) {
              console.log('[useComponentAutoLoad] Current component is entry point, auto-selecting first available');
            }

            const firstComposite = composites[0];
            const firstAtom = atoms[0];

            if (firstComposite) {
              console.log('[useComponentAutoLoad] Auto-loading first composite:', firstComposite.name);
              loadComponent(firstComposite.path);
            } else if (firstAtom) {
              console.log('[useComponentAutoLoad] Auto-loading first atom:', firstAtom.name);
              loadComponent(firstAtom.path);
            } else {
              console.log('[useComponentAutoLoad] No components available');
            }
          }
        }
      } catch (err) {
        console.error('Failed to load components:', err);
        setAvailableComponents({ atoms: [], composites: [], isLoaded: true });
      }
    };

    loadComponents();
  }, [activeProjectId, activeProjectStatus, currentComponentName, loadComponent, mode]);

  return availableComponents;
}
