import type { Root } from 'react-dom/client';

/**
 * Reuse an existing React root across Bun HMR module re-evaluations instead of creating a new
 * one on every hot-reload cycle. Extracted out of client/App.tsx (HYP-1380) purely so this
 * logic — the actual fix for the double-mount crash — has a unit test that does not require
 * importing App.tsx (which mounts a real app to the DOM as an import-time side effect and pulls
 * in the whole provider tree, network calls included).
 *
 * `hotData` is Bun's `import.meta.hot.data` object, which the caller is responsible for typing
 * as `{ root?: Root }` and passing in — this module has no Bun/HMR-specific import of its own,
 * so it stays trivially testable with a plain object stand-in.
 */
export function getOrCreateHmrRoot(hotData: { root?: Root }, createRoot: () => Root): Root {
  return (hotData.root ??= createRoot());
}
