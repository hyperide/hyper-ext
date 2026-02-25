import { lazy, Suspense, type ComponentProps } from 'react';
import type { EditorProps, OnMount } from '@monaco-editor/react';

// Lazy load Monaco components to reduce initial bundle size
// Monaco is ~4-6 MB and only needed when editing code

const MonacoEditor = lazy(() => import('./MonacoEditor'));

// Lazy load raw Editor from @monaco-editor/react for components that need it directly
const RawEditor = lazy(() =>
	import('@monaco-editor/react').then((mod) => ({ default: mod.default })),
);

// Re-export OnMount type for convenience
export type { OnMount };

// Minimal loading placeholder shown only while the Monaco chunk downloads (typically cached after first load).
// The real editable textarea lives in MonacoEditor.tsx and handles the longer Monaco initialization phase.
function EditorLoading() {
	return (
		<div className="flex h-full w-full items-center justify-center bg-background">
			<div className="flex items-center gap-2 text-muted-foreground">
				<div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" />
				<span className="text-xs">Loading editor...</span>
			</div>
		</div>
	);
}

export function LazyMonacoEditor(
	props: ComponentProps<typeof MonacoEditor>,
) {
	return (
		<Suspense fallback={<EditorLoading />}>
			<MonacoEditor {...props} />
		</Suspense>
	);
}

export function preloadMonacoEditor() {
	void import('./MonacoEditor');
}

// Lazy wrapper for raw Editor from @monaco-editor/react
export function LazyEditor(props: EditorProps) {
	return (
		<Suspense fallback={<EditorLoading />}>
			<RawEditor {...props} />
		</Suspense>
	);
}
