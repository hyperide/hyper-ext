/**
 * @file Canonical machine-readable skip/result reason codes shared by D2 (routing) and D3 (ladder)
 *
 * Accessed via: multi-select batch write planning (D2) and the stylability skip-banner (D3)
 * Assumptions: this is the SINGLE source of truth for skip reasons. D2 emits into it; the D3
 *   skip-banner renders from it. Never maintain a second enum (D2 spec §4.4 / D3 spec §5.3).
 * Architecture: docs/specs/2026-06-11-270-d2-source-routing.md §4.4,
 *   docs/specs/2026-06-11-270-d3-stylability-ladder.md §5.3
 */

/**
 * Stable machine reason underneath the user-friendly banner text. Distinct codes drive
 * distinct product signals (adapter gap vs structural blocker — D3 §5.3a), so they must not
 * be collapsed.
 */
const SKIP_REASON_CODES = [
  /** No L0/L1/L2 surface (D3) or Auto resolved to nothing concrete and the UIKit floor does not apply (D2). Also the terminal state for a v1 L3 candidate (escalation deferred). */
  'NO_WRITABLE_TARGET',
  /** Selection / source / snapshot changed between inspector read and write flush. (Internal plan-guard state STALE_PLAN maps to this wire/UI code at the result boundary.) */
  'STALE_SOURCE',
  /** Existing owner is masked (inline style / later class order / higher specificity) so editing it is a visual no-op. Paired with the applied_but_ineffective result status. */
  'OWNER_MASKED',
  /** Style comes from clsx / cva / a conditional prop / items.map(...) / spread props — not a plain editable slot. */
  'EXPRESSION_BACKED_SOURCE',
  /** Adapter gap: the DS adapter does not map this property YET (our roadmap, not a property of the world). Distinct from structural blockers (D3 §5.3a). */
  'DS_ADAPTER_UNMAPPED_PROPERTY',
  /** Reserved for the deferred L3 wrapper path; in v1 an L3 candidate reports NO_WRITABLE_TARGET. Allocated now so the follow-up does not renumber. */
  'L3_REQUIRES_OPT_IN',
  /** Multiple plausible owners with no deterministic pick (e.g. masked / conflicting). */
  'AMBIGUOUS_OWNER',
  /** Element is a locked / read-only component. */
  'LOCKED_COMPONENT',
] as const;

export type SkipReasonCode = (typeof SKIP_REASON_CODES)[number];

/** Per-element / per-property write outcome the host returns authoritatively (D2 §6.2). The UI must NOT infer success from an HTTP 200. */
export type StyleWriteEntryStatus = 'applied' | 'skipped' | 'failed' | 'applied_but_ineffective';

/**
 * Human label for a cascade fallback target system (D2 "where it landed" badge, CTO 2026-06-11).
 * Plain text — the badge styles it. Used to render e.g. "shadow → inline (outside TW scale)".
 */
export function describeLandedSystem(system: string): string {
  switch (system) {
    case 'inline-style':
      return 'inline';
    case 'tailwind-v3':
    case 'tailwind-v4':
      return 'Tailwind';
    case 'css-modules':
      return 'CSS Module';
    default:
      return system;
  }
}

/**
 * Trailing clause explaining WHY a property landed lower (D2 badge). Empty for the unremarkable
 * cases. The marquee case is 'inexpressible' → "(outside the system's scale)".
 */
export function describeLandedReason(reason: string): string {
  switch (reason) {
    case 'inexpressible':
      return " (outside the system's scale)";
    case 'project-default':
    case 'project-system':
      return ' (project default)';
    default:
      return '';
  }
}

/** Human-facing summary line for a skipped element, derived from its reason code. Plain text — the banner styles it. */
export function describeSkipReason(code: SkipReasonCode): string {
  switch (code) {
    case 'NO_WRITABLE_TARGET':
      return 'no style surface';
    case 'STALE_SOURCE':
      return 'selection changed before the write landed';
    case 'OWNER_MASKED':
      return 'the existing style is masked, so the edit would be invisible';
    case 'EXPRESSION_BACKED_SOURCE':
      return 'styled by an expression (clsx / cva / a prop) that cannot be edited directly';
    case 'DS_ADAPTER_UNMAPPED_PROPERTY':
      return "this design-system component doesn't expose this property yet";
    case 'L3_REQUIRES_OPT_IN':
      return 'needs an explicit wrapper to become styleable';
    case 'AMBIGUOUS_OWNER':
      return 'multiple conflicting style sources, no safe pick';
    case 'LOCKED_COMPONENT':
      return 'locked / read-only component';
  }
}
