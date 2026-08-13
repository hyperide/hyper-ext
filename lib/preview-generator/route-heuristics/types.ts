/**
 * @file Shared types for code-derived route extraction.
 *
 * Accessed via: route-heuristics/index.ts → PreviewFileManager / extension preview panel.
 * Assumptions: every extractor is best-effort. A throw or zero matches yields `[]`,
 *   which the UI reads as "no suggestions, render no dropdown".
 */

/** A single route suggestion derived from project source. */
export interface RouteSuggestion {
  /** The address to navigate to, always starting with `/` (e.g. `/`, `/about`, `/users/:id`). */
  path: string;
  /**
   * Where the path came from — used only for ranking/dedupe, never shown verbatim.
   * `route-config` (an explicit router declaration) outranks a `link` (a scanned `<a>`/`<Link>`).
   */
  source: 'route-config' | 'file-route' | 'link';
}
