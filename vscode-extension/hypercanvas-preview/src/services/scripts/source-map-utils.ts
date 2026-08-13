/**
 * Source map and source ref utility functions
 */

import type { SourceLocation } from '@shared/element-tracing/types';

/**
 * Parse a nodeRef string into a SourceLocation.
 * Format: "fileName:line:column"
 */
export function parseSourceRef(nodeRef: string): SourceLocation | null {
  const match = nodeRef.match(/^(.*):(\d+):(\d+)$/);
  if (!match) return null;
  return {
    fileName: match[1],
    line: Number.parseInt(match[2], 10),
    column: Number.parseInt(match[3], 10),
  };
}

/**
 * Build a .map URL by appending .map to the pathname, preserving query params.
 * Naive `url + ".map"` breaks when Vite adds ?t=<timestamp> for HMR:
 *   /src/App.tsx?t=123  →  /src/App.tsx?t=123.map  (WRONG — Vite misroutes)
 * Correct: /src/App.tsx?t=123  →  /src/App.tsx.map?t=123
 */
export function buildMapUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname += '.map';
    return parsed.href;
  } catch {
    // Not a full URL (relative path) — split on ? manually
    const qIdx = url.indexOf('?');
    if (qIdx === -1) return `${url}.map`;
    return `${url.substring(0, qIdx)}.map${url.substring(qIdx)}`;
  }
}

/**
 * Check if a URL is a Vite source URL (has /src/ and no /node_modules/).
 */
export function isViteSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes('/src/') && !parsed.pathname.includes('/node_modules/');
  } catch {
    return url.includes('/src/') && !url.includes('/node_modules/');
  }
}
