/**
 * @file HYP-901 — shared shape for the "style write could not be verified to land anywhere"
 * warning, surfaced ONLY once the verify-and-retry chain (direct write, then auto-wrap) is
 * exhausted — the master-spec Level-4 "can't-style" last resort
 * (docs/specs/2026-06-12-styles-system-master-spec.md §8.4), never the first response to a
 * non-forwarding custom component.
 *
 * Accessed via: produced host-side by the VS Code extension's style-write path
 * (services/style-forwarding-check.ts + ast-update-utils.ts → AstBridge's ast:updateStyles
 * response `data.warning`), carried across the webview RPC boundary, and consumed client-side
 * (RightSidebar) to show an honest "this could not be applied" notice.
 * Assumptions: by the time this value exists, the write pipeline has ALREADY tried (a) the
 * direct write + runtime verify and (b) the auto-wrap candidate + runtime verify (when eligible)
 * and rolled both back — the file is unchanged from before the edit. This is not a "we wrote
 * something, hope it works" notice; it means nothing was written.
 */
/**
 * WHY the style edit could not be auto-applied — the fact the AI-assisted remediation flow (HYP-990
 * M2) leads with when it inspects and proposes a fix.
 *  - `component-does-not-forward` — the target is a custom component that drops `style`/`className`,
 *    and no safe wrapper could be inserted (a `ref`/`key`, a structurally-constrained parent, …).
 *  - `pseudo-state-not-wrappable` — the edit is a `:hover`/`:focus`/… state, which a wrapper's inline
 *    `style` (base-state only) cannot express.
 *  - `property-not-verifiable` — the edited property is one a wrapped child never reflects (opacity,
 *    borders, shadow, an image/gradient), so a wrap could not be verified to land.
 *  - `wrap-not-visible` — a wrapper WAS tried but its colour is covered by an opaque root or an opaque
 *    background-image/gradient (the C3 fail-closed case), so it was rolled back.
 *  - `wrap-had-no-effect` — a wrapper WAS tried and verified, but no edited property's rendered value
 *    changed (e.g. the child overrides the inherited value), so it was rolled back.
 *  - `kept-unverified` — a wrapper was KEPT but could not be verified (no live preview, a build too
 *    slow to settle within the poll budget, or the component renders no DOM element to read); the
 *    edit IS applied (master spec §9.4 `exact + unverifiable = keep + report` — the write was
 *    already trusted at `exact` confidence, so a merely-unconfirmable read is not grounds to revert
 *    it, but the keep is never silent). This is the ONE reason that pairs with `kept: true` — the
 *    edit was NOT reverted.
 *  - `probable-unverifiable` — a wrapper WAS tried, but its verify read cannot be trusted (§9.4
 *    `probable + unverifiable = ROLLBACK — never silently keep`): today the sole `probable`-
 *    confidence case in this write path is a repeated `.map()` list instance, where the runtime
 *    verify always reads DOM occurrence 0 regardless of which occurrence was actually edited
 *    (HYP-1011), so an unverifiable or no-effect read for a non-zero occurrence is rolled back
 *    rather than kept on an untrustworthy signal.
 */
export type StyleForwardingReason =
  | 'component-does-not-forward'
  | 'pseudo-state-not-wrappable'
  | 'property-not-verifiable'
  | 'wrap-not-visible'
  | 'wrap-had-no-effect'
  | 'kept-unverified'
  | 'probable-unverifiable';

/** A source location (1-based line) the AI-fix prompt points the agent at. Local to this
 *  module — consumers reach it structurally through {@link StyleForwardingDiagnosis}. */
interface StyleForwardingSourceLocation {
  /** Absolute or workspace-relative file path. */
  filePath: string;
  line: number;
}

/**
 * HYP-990 M2 — the STRUCTURED diagnosis the host produces alongside the human message, so the "Auto
 * fix via AI" flow can inspect with real facts (why it didn't apply, which component, where it is
 * defined vs used, what was edited) instead of re-deriving them, then propose a concrete fix and ask
 * the user to confirm — or offer to leave the edit reverted.
 */
export interface StyleForwardingDiagnosis {
  reason: StyleForwardingReason;
  /** JSX tag name of the custom component the edit targeted. */
  componentName: string;
  /** The CSS properties the user edited (camelCase / custom-property form). */
  editedProperties: string[];
  /** Where the non-forwarding component is DEFINED (so the AI can add forwarding there). Absent when
   *  the definition could not be pinpointed (external package, unresolved barrel). */
  componentDefinition?: StyleForwardingSourceLocation;
  /** Where the edit was attempted — the JSX CALL SITE the user selected. */
  callSite?: StyleForwardingSourceLocation;
}

export interface StyleForwardingWarning {
  /** JSX tag name of the custom component the edit targeted, e.g. "HostRoutePage". */
  componentName: string;
  /**
   * SHORT one-line message for the platform's standard notification (a VS Code
   * `showWarningMessage` toast / the SaaS toast title) — CTO tg#9125: the toast stays clean, the full
   * reasoning is one click away ({@link message}) and the full structured context always reaches the
   * AI ({@link diagnosis}). OPTIONAL because this type crosses the webview/host protocol boundary,
   * where a version-skewed older producer may omit it (review, Fable) — consumers fall back to a
   * static title.
   */
  shortMessage?: string;
  /** Full user-facing explanation revealed via the notification's "Details" affordance. */
  message: string;
  /**
   * HYP-990 (codex full panel) — true when the edit was KEPT despite being unverifiable (a distinct
   * `keep-report` disposition, master spec §9.4), NOT reverted. Consumers must then present it as
   * "applied but could not verify" and must NOT revert the optimistic Inspector value.
   */
  kept?: boolean;
  /** HYP-990 M2 — structured facts driving the "Auto fix via AI" inspect → propose → confirm flow. */
  diagnosis?: StyleForwardingDiagnosis;
  /**
   * Set by the host when the warning was ALREADY presented natively (VS Code
   * `showWarningMessage`, CTO tg#9122). The webview then still reverts its optimistic Inspector value
   * (the write was rolled back) but does NOT render its own toast — so there is no duplicate custom
   * card, yet the Inspector stays in sync with the source (review, Opus #3).
   */
  presentedNatively?: boolean;
}

// The "Auto fix via AI" prompt builder moved to `shared/style-forwarding/autofix-prompt.ts`
// (behaviour belongs in a lib module, not this protocol-boundary types module — review, Opus/Fable).
