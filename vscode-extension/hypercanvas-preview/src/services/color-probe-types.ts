/**
 * HYP-544 Phase 3 — shared types for the empirical color-probe RPC.
 *
 * The probe MECHANISM lives in the preview-iframe bundle (`services/scripts/iframe-color-probe.ts`,
 * browser realm). The host (PanelRouter / PreviewPanel, Node realm) only needs the RPC result
 * SHAPE — kept here so the host never imports browser code, and the two realms can't drift.
 */
type ColorProbeCandidateKind = 'tailwind-class' | 'inline-style' | 'css-var' | 'module-class';

export interface ColorProbeCandidate {
  kind: ColorProbeCandidateKind;
  token: string;
  locationHint: string;
}

/** What the host hands the iframe to run a probe (mirrors the live-className RPC envelope). */
export interface ColorProbeRequest {
  /** Iframe-relative (pre-re-root) element id — matches findElementsByRef. */
  elementId: string;
  /** Item index of the selected occurrence at a repeated JSX site (.map() row). */
  itemIndex?: number | null;
  /** Conflict prefixes for the changed property (getConflictingPrefixes), computed host-side. */
  prefixes: string[];
  /** camelCase computed-style property, e.g. 'backgroundColor'. */
  cssProp: string;
  /** The requested color (often a hex from the inspector palette). */
  requestedColor: string;
  /** For a class candidate, the request class to swap in on the clone (e.g. 'bg-red-600'). */
  requestClass?: string;
}
