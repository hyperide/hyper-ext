import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from 'react';
import { loadPersistedState, savePersistedState } from '@/lib/storage';
import { authFetch } from '@/utils/authFetch';

interface ComponentMeta {
	componentName: string;
	projectName?: string;
	projectId?: string;
	repoPath: string;
	filePath?: string;
	relativeFilePath?: string;
}

interface ComponentMetaContextType {
	meta: ComponentMeta | null;
	setMeta: (meta: ComponentMeta) => void;
	loadComponent: (componentPath: string) => Promise<void>;
	loadingComponent: string | null;
	parseError: string | null;
	setParseError: (error: string | null) => void;
}

export const ComponentMetaContext = createContext<
	ComponentMetaContextType | undefined
>(undefined);

export function ComponentMetaProvider({ children }: { children: ReactNode }) {
	const [meta, setMetaInternal] = useState<ComponentMeta | null>(null);
	const [loadingComponent, setLoadingComponent] = useState<string | null>(null);
	const [parseError, setParseError] = useState<string | null>(null);

	const setMeta = useCallback((newMeta: ComponentMeta) => {
		setMetaInternal(newMeta);
		// Save opened component path to localStorage
		if (newMeta?.relativeFilePath) {
			savePersistedState({ openedComponent: newMeta.relativeFilePath });
		}
	}, []);

	const loadComponent = useCallback(async (componentPath: string) => {
		try {
			setLoadingComponent(componentPath);
			setParseError(null);

			const response = await authFetch(
				`/api/parse-component?path=${encodeURIComponent(componentPath)}`,
			);
			const data = await response.json();

			if (data.success) {
				// Don't setMeta here - let App.tsx do it after updating metadata
				// This ensures metadata is updated before LeftSidebar re-renders

				// Emit event для перезагрузки canvas
				window.dispatchEvent(
					new CustomEvent('component-loaded', { detail: data }),
				);
			} else if (data.error) {
				setParseError(data.error);
			}
		} catch (error) {
			console.error('Failed to load component:', error);
			setParseError(
				error instanceof Error ? error.message : 'Failed to parse component',
			);
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
			}}
		>
			{children}
		</ComponentMetaContext.Provider>
	);
}

export function useComponentMeta() {
	const context = useContext(ComponentMetaContext);
	if (!context) {
		throw new Error(
			'useComponentMeta must be used within ComponentMetaProvider',
		);
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
