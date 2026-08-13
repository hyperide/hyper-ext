/**
 * @file Types for the app-preview chrome (address bar + route suggestions).
 *
 * Accessed via: AddressBar / RouteSuggestionList in this directory, and the ext + SaaS
 *   chromes that host them. Kept framework-free so both surfaces share one definition.
 */

/** A single route suggestion rendered in the address-bar dropdown. */
export interface RouteSuggestionItem {
  /** The address to navigate to (always starts with `/`). */
  path: string;
  /** Provenance — drives the row glyph and ordering. Mirrors the heuristics' RouteSuggestion. */
  source: 'route-config' | 'file-route' | 'link';
}
