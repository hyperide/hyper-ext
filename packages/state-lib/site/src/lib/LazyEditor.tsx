import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * The editor, loaded when a reader first reaches a page that has one.
 *
 * CodeMirror is ~140 kB gzipped and only the playground needs it; behind
 * `import()` it is a separate chunk in the served build, so every other page's
 * first paint does not pay for it. In the single-file build the same `import()`
 * is inlined and resolves synchronously — the code is identical, the bundler
 * decides. The placeholder keeps the page's height so nothing jumps when the
 * chunk arrives.
 */
const Editor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })));

export function LazyEditor(props: ComponentProps<typeof Editor>) {
  return (
    <Suspense fallback={<div className="cm-host cm-loading" style={{ minHeight: props.minHeight ?? 200 }} />}>
      <Editor {...props} />
    </Suspense>
  );
}
