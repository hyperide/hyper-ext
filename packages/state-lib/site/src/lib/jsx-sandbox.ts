import {
  createElement,
  Fragment,
  useState,
  useEffect,
  useRef,
  useReducer,
  useMemo,
  useCallback,
  useSyncExternalStore,
  memo,
} from 'react';
import type * as Sucrase from 'sucrase';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Runs a reader's JSX against real React and mounts it (R38).
 *
 * Every example on the playground can carry a UI: the code the reader edits
 * is JSX, it is transpiled in the browser, evaluated with React and the
 * toolkit's own API in scope, and whatever it returns is mounted next to the
 * output. Click a checkbox in the UI and the same store the output was printed
 * from changes. This is same-origin execution, not a security sandbox. Review code
 * before running it; never paste privileged credentials.
 *
 * The transpiler (sucrase, JSX + TypeScript syntax only, no type checking) is
 * behind `import()` so it loads when the first UI example runs and not before.
 * It emits `React.createElement`, so a `React` binding is supplied to the
 * evaluated code alongside the hooks the examples use.
 */

const REACT_SCOPE = {
  React: { createElement, Fragment },
  createElement,
  Fragment,
  useState,
  useEffect,
  useRef,
  useReducer,
  useMemo,
  useCallback,
  useSyncExternalStore,
  memo,
};

export const REACT_SCOPE_NAMES = Object.keys(REACT_SCOPE);

let transpiler: Promise<typeof Sucrase> | null = null;
const loadTranspiler = () => (transpiler ??= import('sucrase'));

/** JSX/TS source → plain JS the sandbox can `new Function` over. */
export async function transpileJsx(src: string): Promise<string> {
  const { transform } = await loadTranspiler();
  return transform(src, { transforms: ['jsx', 'typescript'], jsxRuntime: 'classic', production: true }).code;
}

/** The React values an example's code may reference, in the order the sandbox binds them. */
export function reactScope(): Record<string, unknown> {
  return { ...REACT_SCOPE };
}

/**
 * Mounts an element into a host node and returns a disposer. Each run gets a
 * fresh root: a previous run's tree, still subscribed to a previous run's
 * store, must not survive into the next.
 */
export function mountUi(host: HTMLElement, element: unknown): () => void {
  const root: Root = createRoot(host);
  root.render(element as Parameters<Root['render']>[0]);
  return () => root.unmount();
}
