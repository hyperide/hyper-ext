/**
 * @file Shared HTML response helpers for preview proxy pipeline.
 *
 * Accessed via: SaaS project-preview.ts + VS Code extension PreviewProxy.ts
 * Assumptions: operates on buffered HTML strings (not streams)
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

/**
 * Swap the user entry `<script type="module">` src to point to the standalone preview entry.
 * Filters out Vite internals (/@vite, /@react-refresh) and CDN scripts (https://).
 * If no user script is found, returns html unchanged.
 */
export function swapEntryScript(html: string, newSrc: string, viteBase = ''): string {
  const re = /<script\s+type="module"\s+src="([^"]+)"\s*>/g;
  let userSrc: string | null = null;

  for (const match of html.matchAll(re)) {
    const src = match[1];
    if (!src.startsWith('/@') && !src.startsWith('https://') && !src.startsWith(`${viteBase}@`)) {
      userSrc = src;
      break;
    }
  }

  if (!userSrc) return html;
  return html.replace(`src="${userSrc}"`, `src="${newSrc}"`);
}
