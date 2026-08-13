/**
 * @file The detected-project-UIKit literal union — the single shared vocabulary for "what UI
 * kit did we detect in this project" across the SaaS client, the VS Code extension, and every
 * `lib/` consumer that maps a UIKit to a behavior (e.g. `style-write/ui-kit-default-system.ts`).
 *
 * Deliberately a leaf module with ZERO imports: `lib/types.ts` (foundational shared-types),
 * `lib/style-write/ui-kit-default-system.ts` (a leaf mapper), and the SaaS/extension `UIKitType`/
 * `ProjectCapabilities.uiKit` fields all depend on this file — this file must never depend on any
 * of them, or the dependency direction inverts (HYP-984 review finding: the union used to live
 * inside `style-write/ui-kit-default-system.ts`, a leaf mapper, with `lib/types.ts` — a more
 * foundational module — importing FROM it).
 *
 * Past bug this type exists to prevent: `uiKitToDefaultCssSystem` (and
 * `getColorTokenProvider`/`getStyleAdapter` in the extension's MCP color-token-provider) used to
 * accept a bare `string` "so both platforms could pass without a cross-package type import" — a
 * renamed UIKit label (e.g. `'tailwind'` → `'tw'`) would then silently fall through to the
 * `undefined`/Tailwind-default branch instead of failing to compile.
 */
export type UiKitLabel = 'tailwind' | 'tamagui' | 'none';
