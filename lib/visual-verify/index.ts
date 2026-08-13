/**
 * @file Browser-safe public API for the visual-verification utilities.
 *
 * Accessed via: agent proof/screenshot guards, e2e blank-webview guard, and the
 *   product visual-verification subsystem.
 * Assumptions: this barrel is DEPENDENCY-FREE and safe to import from any bundle
 *   (client/webview/server). The headless-Chrome capture helper is intentionally
 *   NOT re-exported here — it pulls in playwright-core (Node-only fs/child_process)
 *   and lives on its own subpath `./capture-and-verify` so a browser bundle that
 *   imports the detector can't transitively drag a browser driver into the build.
 */

export {
  assertStyled,
  computeStylePresence,
  detectStylePresenceInDocument,
  detectStylePresenceOnPage,
  STYLE_PRESENCE_DEFAULTS,
  StyleMissingError,
} from './detect-style-presence';
export type {
  AppRootSignal,
  ComputedStyleSignal,
  DetectStyleOptions,
  EvaluablePage,
  StylePresenceSignals,
  StylePresenceVerdict,
  StyleSheetSignal,
} from './detect-style-presence';

// NOTE: `captureAndVerify` is deliberately NOT re-exported from this barrel.
// Import it from the Node-only subpath instead:
//   import { captureAndVerify } from '@lib/visual-verify/capture-and-verify';
