/**
 * @file Shared overlay theme — types for overlay CSS custom properties.
 *
 * Accessed via: All overlay components in this directory consume `--overlay-*` values
 *   through normal `var(--overlay-bg)` references in their inline styles. This module
 *   only defines the *type surface*; the actual values are injected globally by each
 *   platform's CSS (`client/global.css` in SaaS, `webview/styles.css` in the extension).
 *
 * Assumptions:
 *   - Both platforms define the same set of `--overlay-*` CSS custom properties on :root.
 *   - Consumers must NEVER redeclare `--overlay-*` as an inline `style={{...}}` entry —
 *     doing so produces a self-referential cycle (`--overlay-bg: var(--overlay-bg)`) that
 *     the browser invalidates. Use `var(--overlay-*)` as a *value* only.
 *   - SaaS defines `--overlay-*` as `hsl(var(--background))` / hardcoded colors (Tailwind
 *     HSL tuple format); the extension webview defines them as `var(--vscode-*)`.
 * Architecture: see `.serena/memories/shared-overlay-components.md`.
 */

import type { CSSProperties } from 'react';

/** Exhaustive union of overlay CSS custom property names — gives autocomplete and catches typos */
export type OverlayCSSVarName =
  | '--overlay-bg'
  | '--overlay-fg'
  | '--overlay-muted'
  | '--overlay-border'
  | '--overlay-accent'
  | '--overlay-accent-fg'
  | '--overlay-destructive'
  | '--overlay-link'
  | '--overlay-input-bg'
  | '--overlay-input-fg'
  | '--overlay-input-border'
  // Elevated card/surface behind grouped inputs (the inner Props card). MUST be a
  // different elevation from `--overlay-input-bg` so inputs sitting on it read as
  // inputs; in SaaS dark `--input` and the page bg otherwise collapse to one block.
  | '--overlay-surface'
  | '--overlay-warning'
  | '--overlay-font'
  | '--overlay-font-mono'
  // Modal backdrop — semi-transparent layer behind ComponentErrorOverlay / RuntimeErrorOverlay
  | '--overlay-backdrop'
  // Embedded code-snippet background (RuntimeErrorOverlay codeframe)
  | '--overlay-codeframe-bg'
  // Framework support badges in PreviewSetupOverlay
  | '--overlay-badge-supported'
  | '--overlay-badge-planned'
  // PropsForm + ComponentErrorOverlay (HYP-648): tokens the type-aware props form
  // and the error card need beyond the base error-overlay palette.
  // Disabled "Generate values" button text
  | '--overlay-disabled-fg'
  // Inline "gen"/"rand" button chip background + foreground
  | '--overlay-secondary-bg'
  | '--overlay-secondary-fg'
  // Type badge ("array", "object (JSON)") background
  | '--overlay-badge-bg'
  // Inline `<code>` background for "needs attention" prop names
  | '--overlay-code-bg';

/** Strict mapping from each overlay CSS var name to its value — used for typed inline styles */
export type OverlayCSSVars = { [K in OverlayCSSVarName]?: string };

/**
 * Combined style type: standard CSS properties + overlay custom properties.
 * Intersects with CSSProperties so values are directly assignable to React's `style` prop.
 */
export type OverlayStyle = CSSProperties & OverlayCSSVars;
