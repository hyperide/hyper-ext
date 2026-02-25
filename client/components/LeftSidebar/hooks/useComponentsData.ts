/**
 * Compat hook for loading component groups.
 * SaaS: authFetch('/api/get-components') + window events.
 * VS Code: canvasRPC({ type: 'component:listGroups' }).
 */

import { useState, useEffect, useCallback } from 'react';
import { useCanvasEngineOptional } from '@/lib/canvas-engine';
import { usePlatformCanvas } from '@/lib/platform';
import { canvasRPC } from '@/lib/platform/PlatformContext';
import { authFetch } from '@/utils/authFetch';
import type { ComponentsData } from '../../../../lib/component-scanner/types';

type SetupReason = 'no-ai-config' | 'no-paths' | 'empty-scan';

interface UseComponentsDataResult {
	data: ComponentsData;
	loading: boolean;
	error: string | null;
	reload: () => void;
	setupReason: SetupReason | null;
	loadedOnce: boolean;
}

export function useComponentsData(): UseComponentsDataResult {
	const engine = useCanvasEngineOptional();
	const canvas = usePlatformCanvas();

	const [data, setData] = useState<ComponentsData>({
		atomGroups: [],
		compositeGroups: [],
		pageGroups: [],
	});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [setupReason, setSetupReason] = useState<SetupReason | null>(null);
	const [loadedOnce, setLoadedOnce] = useState(false);

	const loadComponents = useCallback(() => {
		setLoading(true);
		setError(null);
		setSetupReason(null);

		if (engine) {
			// SaaS path: HTTP fetch
			authFetch('/api/get-components')
				.then((res) => res.json())
				.then((result) => {
					if (result.success) {
						setData({
							atomGroups: result.atomGroups || [],
							compositeGroups: result.compositeGroups || [],
							pageGroups: result.pageGroups || [],
						});
						setLoadedOnce(true);
					}
				})
				.catch((err) => {
					console.error('[LeftSidebar] Failed to load components:', err);
					setError(String(err));
				})
				.finally(() => {
					setLoading(false);
				});
		} else {
			// VS Code path: RPC
			canvasRPC<ComponentsData>(
				canvas,
				{ type: 'component:listGroups', requestId: crypto.randomUUID() },
				'component:response',
			)
				.then((result) => {
					if (result.success && result.data) {
						setData(result.data);
						setLoadedOnce(true);
						const msg = result as { needsSetup?: boolean; setupReason?: SetupReason };
						if (msg.needsSetup) {
							setSetupReason(msg.setupReason ?? 'empty-scan');
						}
					} else {
						setError(result.error || 'Failed to load components');
					}
				})
				.catch((err) => {
					setError(String(err));
				})
				.finally(() => {
					setLoading(false);
				});
		}
	}, [engine, canvas]);

	useEffect(() => {
		loadComponents();

		if (engine) {
			// SaaS: listen for SSE-dispatched window events
			const handleComponentsUpdated = () => {
				loadComponents();
			};
			window.addEventListener('components_updated', handleComponentsUpdated);
			return () => {
				window.removeEventListener('components_updated', handleComponentsUpdated);
			};
		}
	}, [loadComponents, engine]);

	return { data, loading, error, reload: loadComponents, setupReason, loadedOnce };
}
