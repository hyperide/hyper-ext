/**
 * @file HYP-901 — static, best-effort check for whether a style-write TARGET is a custom
 * component that forwards `style`/`className` to a DOM element, vs one that silently drops it.
 *
 * Accessed via: ast-update-utils.ts's `updateStyles`, called BEFORE the write (this is the A1
 * "forward-detector" pre-write capability check, master spec docs/specs/2026-06-12-styles-system-
 * master-spec.md §9.2a — "a high-confidence NEGATIVE is a pre-write EXCLUSION: the planner skips
 * that channel before writing, so a swallowing <Button> never gets a blind inline write").
 *
 * History: originally written as a POST-write, warn-only check (HYP-901 first pass); Alex rejected
 * that shape (tg#6243) — the master spec requires verify-then-retry, not warn-and-give-up. This
 * module answers the PRE-write question so the caller can choose a different candidate (see
 * style-wrap-retry.ts) instead of writing dead code into a prop the component never reads.
 *
 * HYP-995: the component-resolution + per-prop forwarding CORE moved to the SHARED
 * `lib/style-write/component-forwarding.ts` so BOTH platforms use one detector (the SaaS executor
 * guard needs the same "does <Tag> forward prop P" answer, per the parity rule). This file keeps the
 * ext-specific PRE-write verdict shape (`forwards` when the component forwards style OR className OR
 * rest — the "can any channel land?" question the upfront ext gate asks) and the human-facing
 * last-resort messages. The narrower CHANNEL-SPECIFIC question (does it forward the ONE prop THIS
 * write's chosen adapter targets?) is enforced downstream in the shared executor (HYP-995).
 */

import type * as t from '@babel/types';
import type { FileIO } from '@lib/ast/file-io';
import { resolveComponentForwarding } from '@lib/style-write/component-forwarding';

// Re-exported from the shared module (HYP-995) so ast-update-utils.ts's imports are unchanged while the
// SaaS route builds the SAME wording. These are the human-facing last-resort messages.
export {
  buildNonForwardingShortMessage,
  buildNonForwardingWarningMessage,
} from '@shared/style-forwarding/warning-messages';

export interface StyleForwardCheckInput {
  /** Parsed AST of the file containing the JSX usage (already parsed by the caller). */
  ast: t.File;
  /** Absolute path of the file containing the JSX usage. */
  filePath: string;
  /** The JSX element the style write is about to target. */
  element: t.JSXElement;
  fileIO: FileIO;
  /** tsconfig path-alias map for `filePath`'s project (empty map = relative-only resolution). */
  aliasMap: Record<string, string>;
}

/**
 * `forwards` — the tag is a native DOM element, OR a custom component proven to forward
 *   `style`/`className`/rest (or unresolvable — that is `unknown`).
 * `not-forwarding` — a custom component whose declaration was located and clearly does NOT
 *   forward `style`/`className` at all — a pre-write EXCLUSION (§9.2a). Carries the display name for
 *   the wrap-candidate and, if that also fails, the last-resort warning.
 * `unknown` — can't tell statically (external package, unresolved barrel, parse failure, a plain
 *   non-destructured `props` param, …). Admitted as a normal write candidate — runtime verify (when
 *   available) is the arbiter, not this static check.
 */
export type StyleForwardCheckResult =
  | { kind: 'forwards' }
  | { kind: 'unknown' }
  | {
      kind: 'not-forwarding';
      displayName: string;
      /** HYP-990 M2 — where the non-forwarding component is DEFINED (1-based line), when pinpointed.
       *  Fed to the "Auto fix via AI" diagnosis so the AI knows the file to add forwarding to. */
      definition?: { filePath: string; line: number };
    };

export async function checkStyleForwarding(input: StyleForwardCheckInput): Promise<StyleForwardCheckResult> {
  const facts = await resolveComponentForwarding({
    ast: input.ast,
    filePath: input.filePath,
    element: input.element,
    fileIO: input.fileIO,
    aliasMap: input.aliasMap,
  });
  if (facts.kind === 'native') return { kind: 'forwards' };
  if (facts.kind === 'unknown') return { kind: 'unknown' };
  // A component that forwards ANY of style/className/rest can land SOME channel — the upfront gate
  // admits it. The channel-specific dead-prop case (forwards className but not style, and the write
  // targets `style`) is caught downstream by the shared executor guard (HYP-995).
  if (facts.forwardsStyle || facts.forwardsClassName || facts.forwardsRest) return { kind: 'forwards' };
  return {
    kind: 'not-forwarding',
    displayName: facts.displayName,
    ...(facts.definition ? { definition: facts.definition } : {}),
  };
}
