import { useCallback, useRef, useState } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { StyleAdapter } from '@/lib/canvas-engine/adapters/StyleAdapter';
import type { AstOperations } from '@/lib/platform/types';
import { getDOMClassesFromIframe } from '@/lib/dom-utils';
import { STYLE_DEBOUNCE_MS } from '../constants';

interface UseStyleSyncOptions {
	selectedIds: string[];
	/** File path for the component — used for style writes */
	filePath: string | null;
	styleAdapter: StyleAdapter;
	/** AST operations for text updates (platform-aware) */
	astOps: AstOperations;
	currentState?: string;
	/** Optional engine for DOM class reading (browser mode only) */
	engine?: CanvasEngine | null;
	/** Called when style sync fails (e.g. to open AI chat as fallback) */
	onSyncError?: (styles: Record<string, string>, error: string) => void;
}

interface UseStyleSyncReturn {
	syncStyleChange: (key: string, value: string) => void;
	syncTextChange: (text: string) => void;
	isStyleSyncing: boolean;
}

export function useStyleSync({
	selectedIds,
	filePath,
	styleAdapter,
	astOps,
	currentState,
	engine,
	onSyncError,
}: UseStyleSyncOptions): UseStyleSyncReturn {
	const [isStyleSyncing, setIsStyleSyncing] = useState(false);
	const styleQueueRef = useRef<Map<string, string>>(new Map());
	const styleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const syncStyleChange = useCallback(
		(styleKey: string, styleValue: string) => {
			if (selectedIds.length === 0 || !selectedIds[0]) {
				return;
			}

			const selectedId = selectedIds[0];

			if (!filePath) {
				console.error('[useStyleSync] No file path provided');
				return;
			}

			// Add to queue
			styleQueueRef.current.set(styleKey, styleValue);

			// Clear previous timer
			if (styleTimerRef.current) {
				clearTimeout(styleTimerRef.current);
			}

			// Set new timer to flush queue
			styleTimerRef.current = setTimeout(async () => {
				const styles = Object.fromEntries(styleQueueRef.current);
				styleQueueRef.current.clear();

				// Set syncing state for loading indicators
				setIsStyleSyncing(true);

				try {
					if (engine) {
						// SaaS browser mode: route through engine for undo/redo support
						console.log('[useStyleSync] Syncing style changes via engine:', styles);

						const domClasses = getDOMClassesFromIframe(selectedId);

						if (styleAdapter.writeMode === 'props' && styleAdapter.convertToProps) {
							const rnProps = styleAdapter.convertToProps(styles);
							engine.updateASTProps(selectedId, filePath, rnProps);
						} else {
							engine.updateASTStyles(selectedId, filePath, styles, {
								domClasses,
								instanceProps: {},
								instanceId: selectedId,
								state: currentState,
							});
						}
					} else {
						// VS Code mode: route through astOps RPC
						console.log('[useStyleSync] Syncing style changes via astOps:', styles);

						if (styleAdapter.writeMode === 'props' && styleAdapter.convertToProps) {
							const rnProps = styleAdapter.convertToProps(styles);
							await astOps.updateProps({
								elementId: selectedId,
								filePath,
								props: rnProps,
							});
						} else {
							await astOps.updateStyles({
								elementId: selectedId,
								filePath,
								styles,
								state: currentState,
							});
						}
					}
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error);
					console.error('[useStyleSync] Failed to sync style changes:', errorMsg);
					onSyncError?.(styles, errorMsg);
				} finally {
					setIsStyleSyncing(false);
				}
			}, STYLE_DEBOUNCE_MS);
		},
		[selectedIds, filePath, styleAdapter, astOps, currentState, engine, onSyncError],
	);

	const syncTextChange = useCallback(
		(text: string) => {
			if (selectedIds.length === 0 || !selectedIds[0]) {
				return;
			}

			const selectedId = selectedIds[0];

			if (!filePath) {
				return;
			}

			if (engine) {
				// SaaS browser mode: use engine for proper JSX children replacement + undo/redo
				engine.updateASTProp(selectedId, filePath, 'text', text);
			} else {
				// VS Code mode: use dedicated text update operation
				astOps.updateText({
					elementId: selectedId,
					filePath,
					text,
				}).catch((err) => {
					console.error('[useStyleSync] Text update failed:', err);
				});
			}
		},
		[selectedIds, filePath, astOps, engine],
	);

	return { syncStyleChange, syncTextChange, isStyleSyncing };
}
