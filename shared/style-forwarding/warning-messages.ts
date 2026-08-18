/**
 * @file Shared human-facing messages for the "style write could not be applied to a non-forwarding
 * component" warning. Moved here (HYP-995) from the VS Code extension's `style-forwarding-check.ts`
 * so BOTH platforms produce identical wording: the extension's M1 verify-and-retry path AND the SaaS
 * server route (which refuses a dead component-prop write via the shared executor guard) build the
 * same {@link import('@shared/types/style-forwarding-warning').StyleForwardingWarning}.
 */
import type { StyleForwardingReason } from '@shared/types/style-forwarding-warning';

/** Full user-facing explanation revealed via the notification's "Details" affordance. REASON-AWARE:
 *  the generic "no wrapper could be inserted" is inaccurate for `wrap-not-visible` (a wrapper WAS
 *  inserted but covered) and for the pseudo-state / non-verifiable-property / repeated-list-item cases. */
export function buildNonForwardingWarningMessage(displayName: string, reason?: StyleForwardingReason): string {
  const tag = `\`<${displayName}>\``;
  switch (reason) {
    case 'wrap-not-visible':
      return (
        `Style change could not be applied — ${tag} doesn't forward this prop to the DOM, and a wrapper ` +
        `was inserted around it but stayed hidden (an opaque root or background-image on the component ` +
        `covers it). Consider forwarding style/className to its root DOM element, or targeting a native ` +
        `DOM element inside it.`
      );
    case 'pseudo-state-not-wrappable':
      return (
        `Style change could not be applied — this is a pseudo-state edit (e.g. :hover/:focus) on ${tag}, ` +
        `which a wrapper's inline style cannot express, and the component doesn't forward this prop to the ` +
        `DOM. Consider forwarding className to its root DOM element.`
      );
    case 'property-not-verifiable':
      return (
        `Style change could not be applied — ${tag} doesn't forward this prop to the DOM, and this property ` +
        `cannot be reliably applied via an inserted wrapper. Consider forwarding style/className to its root ` +
        `DOM element, or targeting a native DOM element inside it.`
      );
    case 'wrap-had-no-effect':
      return (
        `Style change could not be applied — ${tag} doesn't forward this prop to the DOM, and a wrapper was ` +
        `inserted but the value did not change what's rendered (the component overrides it on its own root). ` +
        `Consider forwarding style/className to its root DOM element, or targeting a native DOM element inside it.`
      );
    case 'kept-unverified':
      return (
        `Style change was applied to ${tag} via an inserted wrapper, but it could not be verified as visible ` +
        `(no live preview, or the component renders no DOM element to read). If it doesn't look right, use ` +
        `"Auto fix via AI" to forward style/className to its root DOM element.`
      );
    case 'probable-unverifiable':
      return (
        `Style change could not be applied — ${tag} doesn't forward this prop to the DOM, and a wrapper was ` +
        `inserted around a REPEATED list item, so its visibility could not be reliably confirmed for the ` +
        `specific item you edited; it was rolled back rather than kept unconfirmed. Consider forwarding ` +
        `style/className to its root DOM element, or targeting a native DOM element inside it.`
      );
    default:
      return (
        `Style change could not be applied — the custom component (${tag}) doesn't forward this prop to the ` +
        `DOM and no safe wrapper could be inserted automatically. Consider targeting a native DOM element ` +
        `instead.`
      );
  }
}

/** SHORT one-line message for the platform's standard notification toast (CTO tg#9125). */
export function buildNonForwardingShortMessage(displayName: string): string {
  return `Style could not be applied — <${displayName}> doesn't forward this prop to the DOM.`;
}
