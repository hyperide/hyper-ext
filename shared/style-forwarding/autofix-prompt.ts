/**
 * @file HYP-990 M2 — the "Auto fix via AI" chat-prompt builder. Lives in a `shared/` LIB module (not
 * in `shared/types/`, which is a pure protocol-boundary module) because this is BEHAVIOUR — prompt
 * assembly — not a type (review, Opus/Fable). Shared by every platform (SaaS RightSidebar + the VS
 * Code webview + the extension host's native notification) so the AI-assisted remediation flow is
 * identical everywhere.
 */
import type { StyleForwardingWarning } from '../types/style-forwarding-warning';

/** A one-line, human-readable summary of a style-forwarding reason for the AI-fix prompt. Accepts a
 *  raw `string` (the reason arrives as data across the webview/host protocol boundary) and returns
 *  undefined for an UNRECOGNISED reason — a version-skewed newer producer — so the caller can fall
 *  back to the human `message` (review, Opus/Fable). */
function summarizeReason(reason: string): string | undefined {
  switch (reason) {
    case 'component-does-not-forward':
      return 'the component does not forward `className`/`style` to a DOM element, and no wrapper could be inserted around it safely';
    case 'pseudo-state-not-wrappable':
      return 'the edit targets a pseudo-state (e.g. `:hover`/`:focus`) that a wrapper cannot express';
    case 'property-not-verifiable':
      return 'the edited property is one a wrapper cannot reliably apply, and the component does not forward it';
    case 'wrap-not-visible':
      return 'the change was applied to an inserted wrapper, but an opaque root or background-image on the component covers it';
    case 'wrap-had-no-effect':
      return 'a wrapper was inserted but the edited value did not change what is rendered (the component overrides it on its own root)';
    case 'kept-unverified':
      return 'the change was applied via an inserted wrapper, but could not be verified as visible (no live preview, or the component renders no DOM element to read)';
    case 'probable-unverifiable':
      return 'a wrapper was inserted around a repeated list item, but its visibility could not be reliably confirmed for the specific item edited, so it was rolled back';
    default:
      return undefined;
  }
}

/**
 * Build the "Auto fix via AI" chat prompt from a {@link StyleForwardingWarning}. It seeds the agent
 * with the STRUCTURED diagnosis (why it didn't apply, which component, where it is defined vs used,
 * what was edited) and instructs a two-step INSPECT → PROPOSE-and-ASK flow — never a silent
 * auto-apply — with an explicit offer to leave the edit reverted. The full context is always passed
 * (never truncated to the short toast text — CTO tg#9125).
 */
export function buildStyleAutoFixPrompt(warning: StyleForwardingWarning, opts?: { componentPath?: string }): string {
  const { componentName, diagnosis } = warning;
  // The STRUCTURED call site is authoritative for "used in" (codex full panel): a cross-file nodeRef
  // can resolve the selected call site to a different file than the currently-previewed
  // `componentPath`, which would make the prompt say "used in App.tsx" then "attempted at Child.tsx".
  // Fall back to `componentPath` only when there is no structured call site.
  const usedInPath = diagnosis?.callSite?.filePath ?? opts?.componentPath;
  const usedIn = usedInPath ? ` (used in ${usedInPath})` : '';
  // `kept` (an unverifiable keep-report) means the wrapper REMAINS applied — the prompt must NOT claim
  // the editor reverted it (codex full panel), and the closing option is to keep-or-improve, not revert.
  const openingLine = warning.kept
    ? `A style change I made in the visual editor was applied to \`<${componentName}>\`${usedIn} via an inserted wrapper, but I couldn't verify it's actually visible.`
    : `A style change I made in the visual editor did not visibly apply on \`<${componentName}>\`${usedIn}, and the editor reverted it.`;
  const lines: string[] = [
    openingLine,
    '',
    `Detected reason: ${(diagnosis && summarizeReason(diagnosis.reason)) || warning.message}`,
  ];
  if (diagnosis?.editedProperties?.length) {
    lines.push(`Edited CSS properties: ${diagnosis.editedProperties.join(', ')}.`);
  }
  if (diagnosis?.componentDefinition) {
    lines.push(
      `\`<${componentName}>\` is defined at: ${diagnosis.componentDefinition.filePath}:${diagnosis.componentDefinition.line}.`,
    );
  }
  if (diagnosis?.callSite) {
    lines.push(`The edit was attempted at: ${diagnosis.callSite.filePath}:${diagnosis.callSite.line}.`);
  }
  const closingOffer = warning.kept
    ? 'If I would rather not change the component, offer to leave the wrapper as-is or remove it.'
    : 'If I would rather not change the component, offer to leave the edit reverted.';
  lines.push(
    '',
    'Please help me fix this in two steps:',
    `1. INSPECT: open \`<${componentName}>\` and confirm WHY the style ${
      warning.kept ? "can't be verified as visible" : 'did not apply'
    } — does it forward \`className\`/\`style\` to its root DOM element? is an opaque root or background-image covering an inserted wrapper? was the wrong element targeted?`,
    `2. PROPOSE: describe the best way to make this style actually render reliably — e.g. forward \`style\`/\`className\` through \`<${componentName}>\` to its root DOM element, or apply it to a native DOM element inside it — and ASK me to confirm which approach to take. ${closingOffer}`,
    'Do NOT apply any change until I confirm the approach.',
  );
  return lines.join('\n');
}
