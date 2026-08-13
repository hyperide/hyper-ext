/** Framework preview support levels for UI display. */
export type SupportLevel = 'supported' | 'planned' | 'not-planned';

/**
 * Canonical list of frameworks and their HyperIDE preview support status.
 *
 * Consumers:
 *   - client/pages/Editor/components/PreviewSetupOverlay.tsx — SaaS unsupported-framework overlay
 *   - vscode-extension/hypercanvas-preview/src/webview-preview-panel/UnsupportedFrameworkScreen.tsx
 *     — VS Code preview-panel compatibility table (HYP-442)
 *
 * Both surfaces render this list directly — there is no hand-maintained string to
 * keep in sync. Update this array and both follow.
 */
export const FRAMEWORK_SUPPORT: { name: string; level: SupportLevel }[] = [
  { name: 'Next.js (App Router)', level: 'supported' },
  { name: 'Next.js (Pages Router)', level: 'supported' },
  { name: 'Remix', level: 'supported' },
  { name: 'Vite SPA (file-based routing)', level: 'supported' },
  { name: 'Vite SPA (JSX router)', level: 'supported' },
  { name: 'Astro', level: 'supported' },
  { name: 'CRA / Webpack', level: 'supported' },
  { name: 'Parcel', level: 'supported' },
  { name: 'Vue', level: 'planned' },
  { name: 'Svelte / SvelteKit', level: 'planned' },
  { name: 'Solid.js', level: 'planned' },
  { name: 'HTML/CSS (no bundler)', level: 'planned' },
  { name: 'jQuery', level: 'not-planned' },
  { name: 'Vanilla JS', level: 'not-planned' },
  { name: 'Angular', level: 'not-planned' },
];
