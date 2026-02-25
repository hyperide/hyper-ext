/**
 * Hook for SSE subscriptions and network status tracking
 * Handles project stream, file watcher, and polling for stopped projects
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	useReconnectingEventSource,
	type SSEStatus,
} from '@/hooks/useReconnectingEventSource';
import { authFetch } from '@/utils/authFetch';
import { loadPersistedState } from '@/lib/storage';
import type { ProjectData } from './useProjectControl';

interface PollStatus {
	lastPoll: Date | null;
	lastResult: { running: boolean; status: string; phase?: string } | null;
	isPolling: boolean;
}

interface UseProjectSSEProps {
	accessToken: string | null;
	activeProject: ProjectData | null;
	setActiveProject: React.Dispatch<React.SetStateAction<ProjectData | null>>;
	handleProjectUpdate: (project: ProjectData) => Promise<void>;
	/** Optional - file watcher SSE only runs if this is provided */
	reloadComposition?: () => Promise<void>;
}

interface UseProjectSSEReturn {
	sseStatus: {
		projectStream: SSEStatus;
		fileWatcher: SSEStatus;
	};
	isOnline: boolean;
	pollStatus: PollStatus;
}

/**
 * Manages SSE connections for project updates and file watching
 */
export function useProjectSSE({
	accessToken,
	activeProject,
	setActiveProject,
	handleProjectUpdate,
	reloadComposition,
}: UseProjectSSEProps): UseProjectSSEReturn {
	// SSE connection status tracking
	const [sseStatus, setSseStatus] = useState<{
		projectStream: SSEStatus;
		fileWatcher: SSEStatus;
	}>({ projectStream: 'connected', fileWatcher: 'connected' });

	// Network online status
	const [isOnline, setIsOnline] = useState(
		typeof navigator !== 'undefined' ? navigator.onLine : true,
	);

	// Polling status for stopped projects
	const [pollStatus, setPollStatus] = useState<PollStatus>({
		lastPoll: null,
		lastResult: null,
		isPolling: false,
	});

	// Track if we received initial data from project stream (for fallback)
	const receivedProjectDataRef = useRef(false);

	// Track online/offline for UI badge
	useEffect(() => {
		const handleOnline = () => {
			console.log('[Network] Browser went online');
			setIsOnline(true);
		};
		const handleOffline = () => {
			console.log('[Network] Browser went offline');
			setIsOnline(false);
		};
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);
		return () => {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
		};
	}, []);

	// Poll for project status when stopped - detect if pod came back up
	useEffect(() => {
		const projectId = activeProject?.id;
		const projectStatus = activeProject?.status;

		if (!projectId) return;
		if (projectStatus !== 'stopped' && projectStatus !== 'error') {
			// Clear poll status when not polling
			setPollStatus({ lastPoll: null, lastResult: null, isPolling: false });
			return;
		}

		console.log('[StatusPoll] Starting poll for project', projectId);

		const doPoll = async () => {
			setPollStatus((prev) => ({ ...prev, isPolling: true }));
			try {
				const res = await authFetch(`/api/docker/status/${projectId}`);
				if (!res.ok) {
					setPollStatus((prev) => ({
						...prev,
						isPolling: false,
						lastPoll: new Date(),
					}));
					return;
				}

				const data = await res.json();
				console.log('[StatusPoll] Got response:', data);
				setPollStatus({
					lastPoll: new Date(),
					lastResult: {
						running: data.running,
						status: data.status,
						phase: data.phase,
					},
					isPolling: false,
				});

				// Update state if server reports different status
				if (data.status === 'running') {
					console.log('[StatusPoll] Project is now running, updating state');
					setActiveProject((prev: ProjectData | null) =>
						prev ? { ...prev, status: 'running' } : prev,
					);
				} else if (data.status === 'building') {
					console.log('[StatusPoll] Project is building, updating state');
					setActiveProject((prev: ProjectData | null) =>
						prev ? { ...prev, status: 'building' } : prev,
					);
				}
			} catch (err) {
				console.error('[StatusPoll] Failed to poll status:', err);
				setPollStatus((prev) => ({
					...prev,
					isPolling: false,
					lastPoll: new Date(),
				}));
			}
		};

		// Poll every 5 seconds when stopped
		const interval = setInterval(doPoll, 5000);
		// Also poll immediately
		doPoll();

		return () => clearInterval(interval);
	}, [activeProject?.id, activeProject?.status, setActiveProject]);

	// Project stream URL with token and persisted projectId
	const projectStreamUrl = useMemo(() => {
		if (!accessToken) return null;
		const persistedState = loadPersistedState();
		const persistedProjectId = persistedState.projectId;
		let url = `/api/projects/active/stream?token=${encodeURIComponent(accessToken)}`;
		if (persistedProjectId) {
			url += `&projectId=${encodeURIComponent(persistedProjectId)}`;
		}
		return url;
	}, [accessToken]);

	// Subscribe to project status updates via SSE with auto-reconnect
	useReconnectingEventSource({
		url: projectStreamUrl,
		onMessage: useCallback(
			(data: unknown) => {
				receivedProjectDataRef.current = true;
				const project = data as { name?: string; status?: string };
				console.log(
					'[SSE] Project update:',
					project.name,
					'status:',
					project.status,
				);
				handleProjectUpdate(project as ProjectData);
			},
			[handleProjectUpdate],
		),
		onOpen: useCallback(() => {
			console.log('[SSE] Project stream connected');
		}, []),
		onStatusChange: useCallback((status: SSEStatus) => {
			setSseStatus((prev) => ({ ...prev, projectStream: status }));
		}, []),
	});

	// Fallback: if SSE doesn't deliver data within 2s (Cloudflare tunnel buffering issue),
	// fetch active project via regular HTTP request
	useEffect(() => {
		if (!accessToken) return;
		receivedProjectDataRef.current = false;

		const persistedState = loadPersistedState();
		const persistedProjectId = persistedState.projectId;

		const fallbackTimeout = setTimeout(async () => {
			if (receivedProjectDataRef.current) return;
			console.log(
				'[SSE] Fallback: SSE did not deliver data, fetching via HTTP...',
			);
			try {
				if (persistedProjectId) {
					await authFetch(`/api/projects/${persistedProjectId}/activate`, {
						method: 'POST',
					});
				}
				const res = await authFetch('/api/projects/active');
				if (res.ok) {
					const project = await res.json();
					console.log('[SSE] Fallback: Got project via HTTP:', project.name);
					handleProjectUpdate(project);
				}
			} catch (err) {
				console.error('[SSE] Fallback fetch failed:', err);
			}
		}, 2000);

		return () => clearTimeout(fallbackTimeout);
	}, [accessToken, handleProjectUpdate]);

	// File watcher URL
	const fileWatcherUrl = useMemo(() => {
		if (!activeProject?.path || !accessToken) return null;
		return `/api/components/watch?projectPath=${encodeURIComponent(activeProject.path)}&token=${encodeURIComponent(accessToken)}`;
	}, [activeProject?.path, accessToken]);

	// Listen for SSE (for external changes, other tabs, file system edits)
	// Only runs if reloadComposition is provided
	useReconnectingEventSource({
		url: fileWatcherUrl,
		onMessage: useCallback(
			(data: unknown) => {
				const event = data as {
					type?: string;
					git?: { hasChanges: boolean; fileCount: number };
				};
				if (event.type === 'canvas_composition_changed' && reloadComposition) {
					console.log('[SSE] canvas_composition_changed received');
					reloadComposition();
				}
				// Dispatch window events for HeaderSection and other components
				if (
					event.type === 'components_updated' ||
					event.type === 'git_status_changed'
				) {
					window.dispatchEvent(
						new CustomEvent(event.type, {
							detail: event.git || { hasChanges: false, fileCount: 0 },
						}),
					);
				}
				// Dispatch external file change for undo/redo (from chokidar fallback or code-editor)
				if (event.type === 'external_file_change') {
					const fileEvent = event as {
						path?: string;
						undoSnapshotId?: number;
						redoSnapshotId?: number;
						source?: string;
					};
					if (fileEvent.redoSnapshotId !== undefined && fileEvent.path) {
						window.dispatchEvent(
							new CustomEvent('hypercanvas:externalFileChange', {
								detail: {
									filePath: fileEvent.path,
									undoSnapshotId: fileEvent.undoSnapshotId,
									redoSnapshotId: fileEvent.redoSnapshotId,
									source: fileEvent.source || 'external',
									description: fileEvent.path,
								},
							}),
						);
					}
				}
			},
			[reloadComposition],
		),
		onStatusChange: useCallback((status: SSEStatus) => {
			setSseStatus((prev) => ({ ...prev, fileWatcher: status }));
		}, []),
	});

	return {
		sseStatus,
		isOnline,
		pollStatus,
	};
}
