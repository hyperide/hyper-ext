/**
 * Stub for LazyMonaco — Monaco editor is not available in VS Code extension webviews.
 * The VS Code host already provides its own editor; bundling monaco-editor would add ~5MB.
 */
export function LazyEditor() {
  return null;
}

export function LazyMonacoEditor() {
  return null;
}

export function preloadMonacoEditor() {}

export type OnMount = () => void;
