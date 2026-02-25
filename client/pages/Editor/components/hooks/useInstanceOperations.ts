/**
 * Hook for instance CRUD operations in board mode
 * Handles copy, cut, paste, duplicate, delete for sample renderers
 */

import { useCallback } from 'react';
import { authFetch } from '@/utils/authFetch';
import { useToast } from '@/hooks/use-toast';
import type { InstancePosition } from './useCanvasComposition';

interface UseInstanceOperationsProps {
	projectId: string | undefined;
	componentPath: string | undefined;
	setActiveBoardInstance: React.Dispatch<React.SetStateAction<string | null>>;
	setInstances: React.Dispatch<React.SetStateAction<Record<string, InstancePosition>>>;
}

interface UseInstanceOperationsReturn {
	handleInstanceEdit: (instanceId: string) => void;
	handleInstanceCopy: (instanceId: string) => Promise<void>;
	handleInstanceCut: (instanceId: string) => Promise<void>;
	handleInstancePaste: () => Promise<void>;
	handleInstanceDuplicate: (instanceId: string) => Promise<void>;
	handleInstanceDelete: (instanceId: string) => Promise<void>;
	incrementInstanceName: (name: string) => string;
	// Expose these for popup usage
	setEditingInstanceId: React.Dispatch<React.SetStateAction<string | null>>;
	setEditPopupOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

interface UseInstanceOperationsConfig {
	editingInstanceId: string | null;
	setEditingInstanceId: React.Dispatch<React.SetStateAction<string | null>>;
	editPopupOpen: boolean;
	setEditPopupOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Manages instance operations for board mode
 */
export function useInstanceOperations(
	props: UseInstanceOperationsProps,
	config: UseInstanceOperationsConfig,
): UseInstanceOperationsReturn {
	const { projectId, componentPath, setActiveBoardInstance, setInstances } = props;
	const { setEditingInstanceId, setEditPopupOpen } = config;
	const { toast } = useToast();

	// Helper function to increment instance name (e.g., "instance_1" -> "instance_2")
	const incrementInstanceName = useCallback((name: string): string => {
		const match = name.match(/^(.+?)[-_]?(\d+)$/);
		if (match) {
			const [, prefix, num] = match;
			return `${prefix}_${Number.parseInt(num, 10) + 1}`;
		}
		return `${name}_2`;
	}, []);

	// Instance operation handlers for board mode
	const handleInstanceEdit = useCallback(
		(instanceId: string) => {
			setEditingInstanceId(instanceId);
			setEditPopupOpen(true);
		},
		[setEditingInstanceId, setEditPopupOpen],
	);

	const handleInstanceCopy = useCallback(
		async (instanceId: string) => {
			if (!projectId || !componentPath) {
				console.log('[Instance Copy] Missing projectId or componentPath');
				return;
			}

			try {
				const codeResponse = await authFetch(
					`/api/sample-renderer/code?projectId=${encodeURIComponent(projectId)}&componentPath=${encodeURIComponent(componentPath)}&name=${encodeURIComponent(instanceId)}`,
				);

				if (codeResponse.ok) {
					const { code } = await codeResponse.json();
					await navigator.clipboard.writeText(code);
					console.log('[Instance Copy] Code copied to clipboard');
				} else {
					console.error('[Instance Copy] Failed to get renderer code');
				}
			} catch (error) {
				console.error('[Instance Copy] Copy error:', error);
			}
		},
		[projectId, componentPath],
	);

	const handleInstanceCut = useCallback(
		async (instanceId: string) => {
			if (!projectId || !componentPath) {
				console.log('[Instance Cut] Missing projectId or componentPath');
				return;
			}

			try {
				// First copy
				const codeResponse = await authFetch(
					`/api/sample-renderer/code?projectId=${encodeURIComponent(projectId)}&componentPath=${encodeURIComponent(componentPath)}&name=${encodeURIComponent(instanceId)}`,
				);

				if (codeResponse.ok) {
					const { code } = await codeResponse.json();
					await navigator.clipboard.writeText(code);

					// Then delete
					const deleteResponse = await authFetch(
						'/api/sample-renderer/delete',
						{
							method: 'DELETE',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								projectId,
								componentPath,
								name: instanceId,
							}),
						},
					);

					if (deleteResponse.ok) {
						setActiveBoardInstance(null);
						console.log('[Instance Cut] Instance cut');
					} else {
						const error = await deleteResponse.json();
						console.error('[Instance Cut] Delete failed:', error);
					}
				} else {
					console.error('[Instance Cut] Failed to get renderer code');
				}
			} catch (error) {
				console.error('[Instance Cut] Cut error:', error);
			}
		},
		[projectId, componentPath, setActiveBoardInstance],
	);

	const handleInstancePaste = useCallback(async () => {
		if (!projectId || !componentPath) {
			console.log('[Instance Paste] Missing projectId or componentPath');
			return;
		}

		try {
			const code = await navigator.clipboard.readText();
			console.log('[Instance Paste] Clipboard content:', code);

			if (!code || !code.includes('return')) {
				console.warn(
					'[Instance Paste] Clipboard does not contain valid renderer code',
				);
				return;
			}

			// Get list of existing renderers to generate unique name
			const listResponse = await authFetch(
				`/api/sample-renderer/list?projectId=${encodeURIComponent(projectId)}&componentPath=${encodeURIComponent(componentPath)}`,
			);

			if (!listResponse.ok) {
				console.error('[Instance Paste] Failed to get renderer list');
				return;
			}

			const listData = await listResponse.json();

			if (!listData.success) {
				console.error(
					'[Instance Paste] Failed to get renderer list:',
					listData,
				);
				return;
			}

			// renderers is an object like { default: '...', copy1: '...' }
			const existingNames = Object.keys(listData.renderers || {});

			// Generate unique name (use underscore instead of hyphen for valid JS identifier)
			let newName = 'instance_1';
			let counter = 1;
			while (existingNames.includes(newName)) {
				counter++;
				newName = `instance_${counter}`;
			}

			// Add new renderer
			const addResponse = await authFetch('/api/sample-renderer/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectId,
					componentPath,
					name: newName,
					code,
				}),
			});

			if (addResponse.ok) {
				setActiveBoardInstance(newName);
				console.log('[Instance Paste] Instance pasted:', newName);
			} else {
				const error = await addResponse.json();
				console.error('[Instance Paste] Paste failed:', error);
			}
		} catch (error) {
			console.error('[Instance Paste] Paste error:', error);
		}
	}, [projectId, componentPath, setActiveBoardInstance]);

	const handleInstanceDuplicate = useCallback(
		async (instanceId: string) => {
			if (!projectId || !componentPath) {
				console.log('[Instance Duplicate] Missing projectId or componentPath');
				return;
			}

			try {
				// Get current renderer code
				const codeResponse = await authFetch(
					`/api/sample-renderer/code?projectId=${encodeURIComponent(projectId)}&componentPath=${encodeURIComponent(componentPath)}&name=${encodeURIComponent(instanceId)}`,
				);

				if (!codeResponse.ok) {
					console.error('[Instance Duplicate] Failed to get renderer code');
					return;
				}

				const { code } = await codeResponse.json();

				// Generate new name with incremented number
				const newName = incrementInstanceName(instanceId);

				// Add new renderer
				const addResponse = await authFetch('/api/sample-renderer/add', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						projectId,
						componentPath,
						name: newName,
						code,
					}),
				});

				if (addResponse.ok) {
					setActiveBoardInstance(newName);
					console.log('[Instance Duplicate] Instance duplicated:', newName);
				} else {
					const error = await addResponse.json();
					console.error('[Instance Duplicate] Duplicate failed:', error);
				}
			} catch (error) {
				console.error('[Instance Duplicate] Duplicate error:', error);
			}
		},
		[projectId, componentPath, incrementInstanceName, setActiveBoardInstance],
	);

	const handleInstanceDelete = useCallback(
		async (instanceId: string) => {
			if (!projectId || !componentPath) {
				console.log('[Instance Delete] Missing projectId or componentPath');
				return;
			}

			try {
				const response = await authFetch('/api/sample-renderer/delete', {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						projectId,
						componentPath,
						name: instanceId,
					}),
				});

				if (response.ok) {
					const data = await response.json();
					const foundInAst = data.foundInAst ?? true;

					setActiveBoardInstance(null);
					console.log('[Instance Delete] Instance deleted:', instanceId);

					// Delete from canvas.json
					const deleteCompResponse = await authFetch(
						`/api/canvas-composition/${projectId}/${encodeURIComponent(componentPath)}/${encodeURIComponent(instanceId)}`,
						{ method: 'DELETE' },
					);

					if (!deleteCompResponse.ok && !foundInAst) {
						// Not in AST and not in canvas.json — truly doesn't exist anywhere
						toast({
							title: 'Delete failed',
							description: `Instance "${instanceId}" not found`,
							variant: 'destructive',
						});
						return;
					}

					// Remove instance from local state immediately (no HMR needed)
					setInstances((prev) => {
						const next = { ...prev };
						delete next[instanceId];
						return next;
					});

					// Remove instance DOM element from iframe directly (same-origin)
					const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null;
					iframe?.contentDocument
						?.querySelector(`[data-canvas-instance-id="${instanceId}"]`)
						?.remove();
				} else {
					const error = await response.json();
					console.error('[Instance Delete] Delete failed:', error);
				}
			} catch (error) {
				console.error('[Instance Delete] Delete error:', error);
			}
		},
		[projectId, componentPath, setActiveBoardInstance, setInstances, toast],
	);

	return {
		handleInstanceEdit,
		handleInstanceCopy,
		handleInstanceCut,
		handleInstancePaste,
		handleInstanceDuplicate,
		handleInstanceDelete,
		incrementInstanceName,
		setEditingInstanceId,
		setEditPopupOpen,
	};
}
