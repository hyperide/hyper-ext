/**
 * @file Component file templates for the "New component" flow (HYP-1184).
 *
 * Accessed via: create-component-file (host side). Never imported by browser
 *   code paths that don't need it — but it IS pure and browser-safe.
 * Assumptions: Tailwind-first — the dominant project class among HyperIDE
 *   users. Templates use only intrinsic elements and utility classes so a
 *   freshly created component renders in the preview with zero extra setup
 *   (no imports → nothing to resolve → auto-sample scaffolding always works).
 */

import type { ComponentKind } from './types';
import { humanizeComponentName } from './validate-name';

export interface TemplateInput {
  kind: ComponentKind;
  name: string;
}

/** Render the .tsx source for a new component. */
export function renderComponentTemplate({ kind, name }: TemplateInput): string {
  switch (kind) {
    case 'atom':
      return renderAtom(name);
    case 'composite':
      return renderComposite(name);
    case 'page':
      return renderPage(name);
  }
}

function renderAtom(name: string): string {
  const label = humanizeComponentName(name);
  return `export function ${name}() {
  return (
    <div className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-900">
      ${label}
    </div>
  );
}
`;
}

function renderComposite(name: string): string {
  const label = humanizeComponentName(name);
  return `export function ${name}() {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="h-12 w-12 rounded-full bg-gray-200" />
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-gray-900">${label}</h2>
        <p className="text-sm text-gray-500">Build this section by composing smaller pieces.</p>
      </div>
    </section>
  );
}
`;
}

function renderPage(name: string): string {
  const label = humanizeComponentName(name);
  return `export default function ${name}() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-gray-900">${label}</h1>
        <p className="text-sm text-gray-500">This is your new page — edit it right on the canvas.</p>
      </header>
      <section className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
        Drop components here
      </section>
    </main>
  );
}
`;
}
