/**
 * Stubs for SaaS-only modules that are imported by shared components
 * but never executed in VS Code context (guarded by isVSCode checks).
 */

// useComponentMeta — returns null in VS Code context, hook never called
export function useComponentMeta() {
	return { meta: null, loadComponent: () => {}, loadingComponent: null };
}

// useGitStore — returns empty state, hook never called in VS Code
export function useGitStore() {
	return { isPushPopoverOpen: false };
}
