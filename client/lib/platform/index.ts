/**
 * Platform abstraction layer for HyperCanvas
 *
 * @example
 * ```tsx
 * import { PlatformProvider, usePlatform, useGoToCode } from '@/lib/platform';
 *
 * // In app root:
 * <PlatformProvider>
 *   <App />
 * </PlatformProvider>
 *
 * // In components:
 * const { context } = usePlatform();
 * const goToCode = useGoToCode();
 *
 * if (context === 'browser') {
 *   // Show code-server iframe
 * }
 *
 * goToCode('/path/to/file.tsx', 42, 10);
 * ```
 */

// Adapters (for testing or custom usage)
export { createBrowserAdapters } from './BrowserAdapter';

// Provider and hooks
export {
	canvasRPC,
	PlatformProvider,
	useActiveFileChange,
	useGoToCode,
	// Convenience hooks
	useOpenAIChat,
	useOpenFile,
	usePlatform,
	usePlatformApi,
	usePlatformAst,
	usePlatformCanvas,
	usePlatformContext,
	usePlatformEditor,
	usePlatformEvent,
	usePlatformSSE,
	usePlatformTheme,
	useSendPlatformEvent,
	useSSESubscription,
} from './PlatformContext';
// Types
export type {
	ApiAdapter,
	AstOperations,
	CanvasAdapter,
	EditorAdapter,
	MessageOfType,
	PlatformAdapters,
	PlatformContext,
	PlatformMessage,
	SSEAdapter,
	ThemeAdapter,
} from './types';
export { createVSCodeAdapters } from './VSCodeAdapter';

// Shared Editor State (cross-panel sync)
export {
	createSharedDispatch,
	useCanvasMode,
	useCurrentComponent,
	useEngineMode,
	useHoveredId,
	useSelectedIds,
	useSharedEditorState,
	useSharedEditorStateSync,
} from './shared-editor-state';

// Platform hooks
export { useElementStyleData, classNameToStyles } from './hooks/useElementStyleData';
export type { ElementStyleData, UseElementStyleDataOptions } from './hooks/useElementStyleData';
