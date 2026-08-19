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
 * HYP-1235: rewired onto the shared A1 forward-detector (`lib/style-read/forward-detect.ts`'s
 * `detectForwarding`) instead of this file's own, older, coarser three-way check (which only read
 * the target component's own param-destructure shape — no render-body trace, no styled-components
 * recognition, no root-vs-descendant distinction). `detectForwarding` is per-CHANNEL
 * (`className`/`style` independently traced with their own confidence); this file collapses that
 * into the pre-plan ADMIT/EXCLUDE gate `ast-update-utils.ts` needs BEFORE the planner has chosen a
 * channel: `not-forwarding` only when BOTH channels are proven (high-confidence) negatives —
 * anything else (native, `...rest`, at least one high-confidence positive, or genuine
 * low-confidence uncertainty) admits the write attempt, matching the OLD "forwards ANY channel"
 * admit semantics but with materially better evidence (e.g. a `styled.button(...)` factory is now
 * a confident POSITIVE instead of `unknown`). The channel THIS write actually uses is not known
 * yet at this call site — that per-channel refusal already happens downstream, in the shared
 * executor's HYP-995 `refusalForUnforwardedProps` (`lib/style-write/style-write-executor.ts`),
 * which still runs on its own copy (`lib/style-write/component-forwarding.ts`) — unifying THAT
 * consumer's PER-PROP analysis is a separate follow-up. Its LOCATION-resolution fallback for local
 * monorepo workspace packages (a `node_modules` symlink whose `package.json` entry is real `.ts(x)`
 * source) is NOT a gap anymore — it moved to the shared `lib/ast/workspace-package-entry.ts` in
 * THIS same change, and `lib/style-read/forward-detect-locate.ts`'s `locateComponentDeclaration`
 * (which this file's `detectForwarding` call and `resolveNotForwardingDefinition` both go through)
 * now calls it too, so a workspace-package component resolves identically on both paths.
 *
 * Risk accepted knowingly, not silently: this pre-write gate now inherits `forward-detect-trace.ts`'s
 * own open false-exclusion P2s (master spec §9.2a, e.g. a transformed-but-still-referenced
 * destructured binding wrongly read as a high-confidence negative) — pre-HYP-1235 those bugs only
 * mis-fed `ElementFacts` (a read-path display concern); post-HYP-1235 a false double-negative here
 * produces a real write REFUSAL for a component that actually forwards. Gating `not-forwarding` down
 * to only the structurally-certain `excludedReason: 'no-host-forward'` case would remove exactly
 * this PR's other real fix (the `forwards-non-root-only` root-vs-descendant exclusion, see
 * `style-hyp901-hardening.test.ts`), so it stays as-is — the trade is accuracy-on-average (styled-
 * components positive, root-vs-descendant negative) for a residual, tracked false-negative surface
 * (HYP-1233/HYP-1234) shared with the read path. If that false-exclusion class regresses in
 * practice, narrow this file's admit gate before touching the shared trace.
 *
 * Step 2 (type/LSP corroboration) is always skipped here (`skipTypeCorroboration: true`) — it
 * reads real files off disk via `ts.createProgram` (300ms-2s cold), and this check runs on every
 * style write inside `styleWriteMutex.runExclusive`. The interactive read-path call
 * (`StyleReadService.ts`) made the same call for the same reason; step 2 only ever UPGRADES a
 * `low` verdict to a confident positive, so skipping it just means some low-confidence cases stay
 * admitted (the existing "never block on uncertainty" behavior) instead of being proven positive.
 */
import type * as t from '@babel/types';
import type { FileIO } from '@lib/ast/file-io';
import { jsxNameFull, jsxNameRoot } from '@lib/ast/jsx-deps';
import { detectForwarding, type ForwardDetectionResults } from '@lib/style-read/forward-detect';
import { locateComponentDeclaration } from '@lib/style-read/forward-detect-locate';

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
  const detection = await detectForwarding({
    ast: input.ast,
    filePath: input.filePath,
    element: input.element,
    fileIO: input.fileIO,
    aliasMap: input.aliasMap,
    skipTypeCorroboration: true,
  });
  const verdict = classifyForwarding(detection);
  if (verdict !== 'not-forwarding') return { kind: verdict };

  const displayName = jsxNameFull(input.element.openingElement.name);
  const definition = await resolveNotForwardingDefinition(input);
  return { kind: 'not-forwarding', displayName, ...(definition ? { definition } : {}) };
}

/**
 * Collapses `detectForwarding`'s per-channel verdicts into the pre-plan admit/exclude gate — see
 * the file header for why this stays "any channel forwards" shaped rather than channel-specific.
 * `not-forwarding` requires BOTH channels to be a proven (high-confidence) negative; `forwards`
 * requires at least one PROVEN positive; everything else (only low-confidence signal either way)
 * is `unknown` — never a confident admit, never a confident exclusion.
 */
function classifyForwarding(detection: ForwardDetectionResults): 'forwards' | 'unknown' | 'not-forwarding' {
  const classNameExcluded = detection.className.confidence === 'high' && !detection.className.forwardsClassName;
  const styleExcluded = detection.style.confidence === 'high' && !detection.style.forwardsStyle;
  if (classNameExcluded && styleExcluded) return 'not-forwarding';

  const classNameProven = detection.className.confidence === 'high' && detection.className.forwardsClassName;
  const styleProven = detection.style.confidence === 'high' && detection.style.forwardsStyle;
  return classNameProven || styleProven ? 'forwards' : 'unknown';
}

/**
 * Re-resolves the component declaration to pinpoint WHERE it's defined, for the AI-fix diagnosis
 * (HYP-990 M2). Only called on the `not-forwarding` path (rare relative to `forwards`/`unknown`),
 * so re-running `locateComponentDeclaration` here (rather than threading the location detection
 * already did internally) is a deliberate, cheap-in-practice tradeoff — see the file header.
 */
async function resolveNotForwardingDefinition(
  input: StyleForwardCheckInput,
): Promise<{ filePath: string; line: number } | undefined> {
  const tagName = jsxNameRoot(input.element.openingElement.name);
  if (!tagName) return undefined;
  const located = await locateComponentDeclaration(
    { ast: input.ast, filePath: input.filePath, fileIO: input.fileIO, aliasMap: input.aliasMap },
    tagName,
  );
  return located?.definitionLine !== null && located?.definitionLine !== undefined
    ? { filePath: located.declarationFilePath, line: located.definitionLine }
    : undefined;
}
