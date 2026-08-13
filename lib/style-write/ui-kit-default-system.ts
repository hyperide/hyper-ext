/**
 * @file UIKit → project-default CSS system mapping (surfaceless write floor)
 *
 * Accessed via: the SaaS inspector (RightSidebar) and the VS Code extension host (extension.ts)
 *   when deriving the `projectDefaultCssSystem` threaded into a style write request.
 * Why shared: both platforms must floor a SURFACELESS element (no existing className/style) to the
 *   SAME project system under Auto/Computed routing (D2 §4.3). A Tailwind project floors to Tailwind,
 *   never a silent inline `style={{}}`. Duplicating this tiny map per platform is exactly the
 *   parity drift the extension/SaaS shared-logic rule forbids — one function, two callers.
 */
import type { CssSystemId } from '@lib/style-read/types';
import type { UiKitLabel } from '@lib/ui-kit';

/**
 * Map a detected project UIKit label to the `CssSystemId` a surfaceless element should floor to.
 * `'tailwind'` → `'tailwind-v4'`, `'tamagui'` → `'tamagui'`; anything else (including `'none'` /
 * `undefined`) → `undefined`, meaning "no UIKit default" — the write cascade then falls through to
 * a detected project system and, only as the genuine last rung, inline (never a silent skip).
 *
 * Uses an exhaustive `switch` (not `if`/`if`/fallthrough) so adding a member to `UiKitLabel`
 * without updating this mapper is a type error, not a silent fall-through to the `undefined`
 * ("no UIKit default") branch — the exact silent-degrade failure mode HYP-984 introduced this
 * shared type to prevent in the first place.
 */
export function uiKitToDefaultCssSystem(uiKit: UiKitLabel | null | undefined): CssSystemId | undefined {
  if (uiKit == null) return undefined;
  switch (uiKit) {
    case 'tailwind':
      return 'tailwind-v4';
    case 'tamagui':
      return 'tamagui';
    case 'none':
      return undefined;
    default:
      // Exhaustiveness check: a new UiKitLabel member fails to compile here (the assignment
      // below only type-checks when every real member is handled above). Runtime defensively
      // falls through to `undefined` for a value smuggled in via `as UiKitLabel` that isn't
      // actually one of the three labels (see the 'unknown'-cast unit test).
      ((_exhaustive: never) => _exhaustive)(uiKit);
      return undefined;
  }
}
