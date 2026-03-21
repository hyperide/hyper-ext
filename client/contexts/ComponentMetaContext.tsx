import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { savePersistedState } from '@/lib/storage';
import { authFetch } from '@/utils/authFetch';

interface ComponentMeta {
  componentName: string;
  projectName?: string;
  projectId?: string;
  repoPath: string;
  filePath?: string;
  relativeFilePath?: string;
}

export type PreviewSetupStatus = 'ok' | 'unsupported' | 'needs-patch';

interface ComponentMetaContextType {
  meta: ComponentMeta | null;
  setMeta: (meta: ComponentMeta) => void;
  loadComponent: (componentPath: string, sampleName?: string) => Promise<void>;
  loadingComponent: string | null;
  parseError: string | null;
  setParseError: (error: string | null) => void;
  previewSetup: PreviewSetupStatus | null;
  setPreviewSetup: (status: PreviewSetupStatus | null) => void;
  needsPatchPrompt: string | null;
  currentSampleName: string | null;
  setCurrentSampleName: (name: string | null) => void;
}

export const ComponentMetaContext = createContext<ComponentMetaContextType | undefined>(undefined);

export function ComponentMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMetaInternal] = useState<ComponentMeta | null>(null);
  const [loadingComponent, setLoadingComponent] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewSetup, setPreviewSetup] = useState<PreviewSetupStatus | null>(null);
  const [needsPatchPrompt, setNeedsPatchPrompt] = useState<string | null>(null);
  const [currentSampleName, setCurrentSampleName] = useState<string | null>(null);

  const setMeta = useCallback((newMeta: ComponentMeta) => {
    setMetaInternal(newMeta);
    // Save opened component path to localStorage
    if (newMeta?.relativeFilePath) {
      savePersistedState({ openedComponent: newMeta.relativeFilePath });
    }
  }, []);

  const loadComponent = useCallback(async (componentPath: string, sampleName?: string) => {
    try {
      setLoadingComponent(componentPath);
      setParseError(null);
      setPreviewSetup(null);
      setNeedsPatchPrompt(null);

      const effectiveSampleName = sampleName ?? 'default';
      setCurrentSampleName(effectiveSampleName);

      let url = `/api/parse-component?path=${encodeURIComponent(componentPath)}`;
      url += `&sampleName=${encodeURIComponent(effectiveSampleName)}`;

      const response = await authFetch(url);
      const data = await response.json();

      if (data.success) {
        // Don't setMeta here - let App.tsx do it after updating metadata
        // This ensures metadata is updated before LeftSidebar re-renders

        const validStatuses: PreviewSetupStatus[] = ['ok', 'unsupported', 'needs-patch'];
        if (data.previewSetup && data.previewSetup !== 'ok' && validStatuses.includes(data.previewSetup)) {
          setPreviewSetup(data.previewSetup as PreviewSetupStatus);
          setNeedsPatchPrompt(typeof data.needsPatchPrompt === 'string' ? data.needsPatchPrompt : null);
        } else {
          setPreviewSetup(null);
          setNeedsPatchPrompt(null);
        }

        // Emit event для перезагрузки canvas
        window.dispatchEvent(new CustomEvent('component-loaded', { detail: data }));
      } else if (data.error) {
        setParseError(data.error);
      }
    } catch (error) {
      console.error('Failed to load component:', error);
      setParseError(error instanceof Error ? error.message : 'Failed to parse component');
    } finally {
      setLoadingComponent(null);
    }
  }, []);

  return (
    <ComponentMetaContext.Provider
      value={{
        meta: meta,
        setMeta,
        loadComponent,
        loadingComponent,
        parseError,
        setParseError,
        previewSetup,
        setPreviewSetup,
        needsPatchPrompt,
        currentSampleName,
        setCurrentSampleName,
      }}
    >
      {children}
    </ComponentMetaContext.Provider>
  );
}

export function useComponentMeta() {
  const context = useContext(ComponentMetaContext);
  if (!context) {
    throw new Error('useComponentMeta must be used within ComponentMetaProvider');
  }
  return context;
}

/**
 * Safe variant — returns null outside ComponentMetaProvider.
 * Used in components shared between SaaS (has provider) and VS Code (no provider).
 */
export function useComponentMetaOptional() {
  return useContext(ComponentMetaContext) ?? null;
}
