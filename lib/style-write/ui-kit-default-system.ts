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

/**
 * Map a detected project UIKit label to the `CssSystemId` a surfaceless element should floor to.
 * `'tailwind'` → `'tailwind-v4'`, `'tamagui'` → `'tamagui'`; anything else (including `'none'` /
 * `undefined`) → `undefined`, meaning "no UIKit default" — the write cascade then falls through to
 * a detected project system and, only as the genuine last rung, inline (never a silent skip).
 *
 * Accepts a bare `string` so both the SaaS `UIKitType` and the extension's
 * `'tailwind' | 'tamagui' | 'none'` capability field pass without a cross-package type import.
 */
export function uiKitToDefaultCssSystem(uiKit: string | null | undefined): CssSystemId | undefined {
  if (uiKit === 'tailwind') return 'tailwind-v4';
  if (uiKit === 'tamagui') return 'tamagui';
  return undefined;
}
