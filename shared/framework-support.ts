/** Framework preview support levels for UI display. */
export type SupportLevel = 'supported' | 'planned' | 'not-planned';

/**
 * Canonical list of frameworks and their HyperIDE preview support status.
 *
 * Consumers:
 *   - client/pages/Editor/CanvasEditor.tsx — passed to the shared PreviewSetupOverlay
 *     (shared/components/overlays) for the SaaS unsupported-framework overlay
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

/**
 * Formats the "currently supports" line embedded in Auto Fix prompts (HYP-917) — the single
 * source of truth for that phrasing, shared between `buildUnsupportedFrameworkPrompt`
 * (shared/components/overlays/PreviewSetupOverlay.tsx) and `buildDimensionAutoFixPrompt`
 * (vscode-extension/.../SupportDimensionsTabs.tsx) so a future wording/filter tweak can't
 * silently diverge between the two. Returns '' when there's nothing supported to list.
 */
export function buildSupportedFrameworksLine(
  frameworkSupport: readonly { name: string; level: SupportLevel }[] | undefined,
): string {
  const supported = (frameworkSupport ?? []).filter((f) => f.level === 'supported').map((f) => f.name);
  return supported.length > 0 ? `HyperIDE currently supports: ${supported.join(', ')}.` : '';
}
