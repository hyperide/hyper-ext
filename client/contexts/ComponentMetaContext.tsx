import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { savePersistedState } from '@/lib/storage';
import { authFetch } from '@/utils/authFetch';

interface ComponentMeta {
  componentName: string;
  projectName?: string;
  projectId?: string;
  repoPath: string;
  filePath?: string;
  relativeFilePath?: string;
  /**
   * File the active sample export was resolved from (HYP-290h), reported by
   * parse-component. The DOM-mode Sample-array op targets THIS path instead of a
   * hardcoded sibling `*.samples.tsx`. Today it equals `filePath` (samples are inline in
   * the component file); null when no sample was resolved.
   */
  sampleFilePath?: string | null;
}

export type PreviewSetupStatus = 'ok' | 'unsupported' | 'needs-patch';

interface ComponentMetaContextType {
  meta: ComponentMeta | null;
  setMeta: (meta: ComponentMeta) => void;
  /** Resolves `true` when the component parsed/rebuilt successfully, `false` on a handled failure. */
  loadComponent: (componentPath: string, sampleName?: string, appMode?: boolean) => Promise<boolean>;
  loadingComponent: string | null;
  parseError: string | null;
  setParseError: (error: string | null) => void;
  previewSetup: PreviewSetupStatus | null;
  setPreviewSetup: (status: PreviewSetupStatus | null) => void;
  needsPatchPrompt: string | null;
  currentSampleName: string | null;
  setCurrentSampleName: (name: string | null) => void;
}

const ComponentMetaContext = createContext<ComponentMetaContextType | undefined>(undefined);

export function ComponentMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMetaInternal] = useState<ComponentMeta | null>(null);
  const [loadingComponent, setLoadingComponent] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewSetup, setPreviewSetup] = useState<PreviewSetupStatus | null>(null);
  const [needsPatchPrompt, setNeedsPatchPrompt] = useState<string | null>(null);
  const [currentSampleName, setCurrentSampleName] = useState<string | null>(null);

  // Abort controller for the in-flight loadComponent request.
  // Superseded calls (rapid component switching) are cancelled before they
  // can overwrite state with stale results.
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight request when the provider unmounts.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const setMeta = useCallback((newMeta: ComponentMeta) => {
    setMetaInternal(newMeta);
    // Save opened component path to localStorage
    if (newMeta?.relativeFilePath) {
      savePersistedState({ openedComponent: newMeta.relativeFilePath });
    }
  }, []);

  const loadComponent = useCallback(
    async (componentPath: string, sampleName?: string, appMode?: boolean): Promise<boolean> => {
      // Cancel any in-flight request and claim ownership of this load.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      /** True when a newer loadComponent call has superseded this one. */
      const isSuperseded = () => abortRef.current !== controller;

      try {
        setLoadingComponent(componentPath);
        setParseError(null);
        setPreviewSetup(null);
        setNeedsPatchPrompt(null);

        const effectiveSampleName = sampleName ?? 'default';
        setCurrentSampleName(effectiveSampleName);

        let url = `/api/parse-component?path=${encodeURIComponent(componentPath)}`;
        url += `&sampleName=${encodeURIComponent(effectiveSampleName)}`;
        // App-mode: the server marks this path as an app entry (enableAppEntry) before rebuilding
        // the preview, so `?component=…&app=1` renders the entry root raw instead of being rejected.
        if (appMode) {
          url += '&app=1';
        }

        const response = await authFetch(url, { signal: controller.signal });
        const data = await response.json();

        // A newer call overtook us while we were waiting — discard the result.
        if (isSuperseded()) return false;

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
          return true;
        }
        if (data.error) {
          setParseError(data.error);
        }
        return false;
      } catch (error) {
        // Swallow errors from superseded calls — the in-flight abort throws AbortError,
        // and a slow stale call that resolves with a real error after being superseded
        // must not clobber the newer call's state.
        if (isSuperseded()) return false;

        console.error('Failed to load component:', error);
        setParseError(error instanceof Error ? error.message : 'Failed to parse component');
        return false;
      } finally {
        // Only clear the loading indicator if we're still the current call.
        // Otherwise the newer call's indicator would be prematurely cleared.
        if (!isSuperseded()) {
          setLoadingComponent(null);
        }
      }
    },
    [],
  );

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
