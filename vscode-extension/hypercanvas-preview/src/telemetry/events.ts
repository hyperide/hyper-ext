/**
 * Telemetry event taxonomy — the single source of truth for event names.
 *
 * WHAT: `domain.action` event-name constants plus the `TelemetryValue` type and
 * the per-event prop-shape types used across the host-side telemetry pipeline.
 * HOW REACHED: imported by `TelemetryService`, `sender.ts`, `dissatisfaction.ts`,
 * and the instrumentation seams in `extension.ts` / `extension-commands.ts` /
 * `bridges/AIBridge.ts`. Webview code references the string names indirectly via
 * the postMessage `name` field (it never imports node-only telemetry code).
 * INVARIANT: every event property MUST be an enum / count / duration / boolean /
 * hash — NEVER a file path, source code, prompt text, URL, or any free-form user
 * string. New events go here first; nothing should `track()` a name not listed.
 * PII RULE: scrub before it reaches a prop. Use `hashString()` for any message
 * derived from user/source content (see TelemetryService).
 */

/** Allowed primitive value types for a telemetry property. No objects, no arrays. */
export type TelemetryValue = string | number | boolean;

/** A bag of scrubbed, PII-free telemetry properties. */
export type TelemetryProps = Record<string, TelemetryValue>;

/**
 * Canonical event-name constants. Grouped by domain. Keep names stable — they are
 * the schema PostHog/Sentry index on; renaming breaks dashboards.
 */
export const TelemetryEvents = {
  // session
  sessionActivated: 'session.activated',
  sessionHeartbeat: 'session.heartbeat',
  sessionEnded: 'session.ended',
  funnelFirstPreview: 'funnel.firstPreview',

  // command
  commandInvoked: 'command.invoked',

  // preview
  previewRenderSucceeded: 'preview.renderSucceeded',
  previewRenderFailed: 'preview.renderFailed',
  previewBlankDetected: 'preview.blankDetected',

  // devServer
  devServerStarted: 'devServer.started',
  devServerReady: 'devServer.ready',
  devServerFailed: 'devServer.failed',

  // ai
  aiRequestStarted: 'ai.requestStarted',
  aiRequestCompleted: 'ai.requestCompleted',
  aiSuggestionShown: 'ai.suggestionShown',
  aiSuggestionAccepted: 'ai.suggestionAccepted',
  aiSuggestionRejected: 'ai.suggestionRejected',

  // explorer (Hyper Explorer left panel). open/select/navigate are wired in
  // LeftPanelProvider. CRUD (created/renamed/deleted/moved), searched, and
  // treeToggled stay FORWARD-DECLARED: the Hyper Explorer is a read-only AST/
  // component tree — file CRUD belongs to VS Code's own File Explorer (no
  // explorer message exists), while search + tree expand/collapse are purely
  // client-side React state in the SHARED LeftSidebar (used by SaaS too), never
  // posted to the host. Wiring them would mean instrumenting shared cross-
  // platform UI + a new platform message type — deferred (see PR notes).
  explorerItemOpened: 'explorer.itemOpened',
  explorerTreeToggled: 'explorer.treeToggled',
  explorerSearched: 'explorer.searched',
  explorerItemCreated: 'explorer.itemCreated',
  explorerItemRenamed: 'explorer.itemRenamed',
  explorerItemDeleted: 'explorer.itemDeleted',
  explorerItemMoved: 'explorer.itemMoved',
  explorerItemSelected: 'explorer.itemSelected',
  explorerNavigated: 'explorer.navigated',

  // canvas (selection/drag/insert/delete + mode/route/context-menu/zoom/pan).
  canvasElementSelected: 'canvas.elementSelected',
  canvasSelectionCleared: 'canvas.selectionCleared',
  canvasElementHovered: 'canvas.elementHovered',
  canvasDragStarted: 'canvas.dragStarted',
  canvasDragEnded: 'canvas.dragEnded',
  canvasElementResized: 'canvas.elementResized',
  canvasElementMoved: 'canvas.elementMoved',
  canvasElementInserted: 'canvas.elementInserted',
  canvasElementDeleted: 'canvas.elementDeleted',
  canvasElementDuplicated: 'canvas.elementDuplicated',
  canvasElementWrapped: 'canvas.elementWrapped',
  canvasUndo: 'canvas.undo',
  canvasRedo: 'canvas.redo',
  canvasModeSwitched: 'canvas.modeSwitched',
  // routeNavigated (webview, usePreviewBridge) + previewRefreshed (host, the
  // refreshPreview command) are wired. zoomed/panned stay FORWARD-DECLARED: the
  // VS Code preview is a 1:1 iframe (IDENTITY_VIEWPORT) with no zoom/pan — there
  // is no handler to instrument (would re-emerge if a canvas viewport ships).
  canvasRouteNavigated: 'canvas.routeNavigated',
  canvasPreviewRefreshed: 'canvas.previewRefreshed',
  canvasContextMenuOpened: 'canvas.contextMenuOpened',
  canvasContextMenuAction: 'canvas.contextMenuAction',
  canvasZoomed: 'canvas.zoomed',
  canvasPanned: 'canvas.panned',

  // inspector. prop/style/text edits (host, emitAstTelemetry), elementInspected
  // (host, the selection seam in the router), and toggled (host, RightPanel
  // visibility) are wired. tabSwitched stays FORWARD-DECLARED: the style-source
  // tabs live in the SHARED RightSidebar (SaaS too) as client-side React state —
  // wiring it needs shared cross-platform UI + a platform message type (deferred).
  inspectorElementInspected: 'inspector.elementInspected',
  inspectorPropEdited: 'inspector.propEdited',
  inspectorStyleEdited: 'inspector.styleEdited',
  inspectorTextEdited: 'inspector.textEdited',
  inspectorTabSwitched: 'inspector.tabSwitched',
  inspectorToggled: 'inspector.toggled',

  // panel / theme
  panelOpened: 'panel.opened',
  panelClosed: 'panel.closed',
  themeChanged: 'theme.changed',

  // error
  errorUnhandled: 'error.unhandled',
  errorHandled: 'error.handled',
  errorWebviewCrash: 'error.webviewCrash',

  // feedback
  feedbackAiThumb: 'feedback.aiThumb',

  // dissatisfaction (host heuristics)
  dissatisfactionQuickUndo: 'dissatisfaction.quickUndo',
  dissatisfactionRetryLoop: 'dissatisfaction.retryLoop',
  dissatisfactionErrorThenQuit: 'dissatisfaction.errorThenQuit',

  // dissatisfaction (webview origin)
  dissatisfactionRageClick: 'dissatisfaction.rageClick',
  dissatisfactionDeadClick: 'dissatisfaction.deadClick',
  dissatisfactionErrorClick: 'dissatisfaction.errorClick',
} as const;

/**
 * Union of every valid event name. Public vocabulary for emitters/tests.
 * @public
 */
export type TelemetryEventName = (typeof TelemetryEvents)[keyof typeof TelemetryEvents];

/**
 * Allow-list of webview-originated event names. Only these may flow in from a
 * webview `telemetry:event` message; the host rejects anything else so a
 * compromised/buggy webview cannot inject arbitrary event names.
 */
export const WEBVIEW_ALLOWED_EVENTS: ReadonlySet<string> = new Set<string>([
  TelemetryEvents.feedbackAiThumb,
  TelemetryEvents.dissatisfactionRageClick,
  TelemetryEvents.dissatisfactionDeadClick,
  TelemetryEvents.dissatisfactionErrorClick,
  // Webview-origin canvas events posted from useCanvasInteraction via the
  // `telemetry:event` channel. Host-emitted canvas/inspector/explorer events
  // (router + ast path) are NOT listed here — they never cross the webview seam.
  TelemetryEvents.canvasElementSelected,
  TelemetryEvents.canvasSelectionCleared,
  TelemetryEvents.canvasElementHovered,
  TelemetryEvents.canvasDragStarted,
  TelemetryEvents.canvasDragEnded,
  TelemetryEvents.canvasElementResized,
  TelemetryEvents.canvasContextMenuOpened,
  // In-app route navigation observed in the preview iframe (app-mode). Posted
  // from usePreviewBridge with SAFE structural props only (depth + hash flag).
  TelemetryEvents.canvasRouteNavigated,
]);

// ---------------------------------------------------------------------------
// Enum-ish value vocabularies (kept narrow so dashboards stay aggregatable).
// ---------------------------------------------------------------------------

/**
 * Categorized error class for a preview render failure. Public vocabulary.
 * @public
 */
export type PreviewErrorClass = 'componentError' | 'runtimeError' | 'componentMissing';

/** Coarse error category used by preview + devServer failures. */
export type ErrorCategory = 'process_not_defined' | 'provider_context' | 'module_missing' | 'syntax' | 'other';

/**
 * Outcome of a wrapped command or AI request. Public vocabulary.
 * @public
 */
export type Outcome = 'ok' | 'error' | 'cancelled' | 'aborted';

/** Where a handled error originated (for `error.handled`). */
export type HandledErrorWhere = 'aiBridge' | 'devServer' | 'preview' | 'mcp' | 'panelRouter' | 'telemetry';

/**
 * Kind of unhandled process-level error. Public vocabulary.
 * @public
 */
export type UnhandledErrorKind = 'unhandledRejection' | 'uncaughtException';

/**
 * Coarse class of an edited prop/style VALUE. We never send the value itself —
 * only its kind — so a dashboard can tell "user typed a string" from "user wrote
 * a JSX expression" without leaking content.
 */
export type ValueKind = 'string' | 'number' | 'boolean' | 'expression' | 'other';

/** Which extension panel was opened/closed (for panel.opened / panel.closed). */
export type PanelKind = 'preview' | 'explorer' | 'inspector' | 'aiChat' | 'logs';

/** Canvas preview scope, normalized to a stable two-value enum. */
export type CanvasMode = 'component' | 'app';

/** Context-menu action the user invoked on a canvas element. */
export type ContextMenuAction =
  | 'goToCode'
  | 'duplicate'
  | 'delete'
  | 'wrapInDiv'
  | 'copy'
  | 'paste'
  | 'cut'
  | 'selectParent'
  | 'selectChild'
  | 'copyText'
  | 'copyAsHTML';

/**
 * Classify an edited value into a coarse `ValueKind`. Pure; reads the value's
 * TYPE only, never emits the value. A string that looks like a JSX/JS expression
 * (`{...}`, an arrow, JSX tag, or template literal) is reported as `expression`
 * so curly-brace prop edits are distinguishable from literal strings.
 */
export function valueKindOf(v: unknown): ValueKind {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\{.*\}$/.test(s) || s.includes('=>') || /^<.+>/.test(s) || s.includes('`')) {
      return 'expression';
    }
    return 'string';
  }
  return 'other';
}

/**
 * Map a raw (already-scrubbed-safe) error message to a coarse `ErrorCategory`.
 * Operates on the message string ONLY for classification — the string itself is
 * never emitted; callers emit `hashString(message)` instead. Order matters: the
 * blank-preview `process is not defined` check wins over the generic checks.
 */
export function categorizeErrorMessage(message: string | undefined | null): ErrorCategory {
  if (!message) return 'other';
  const m = message.toLowerCase();
  if (m.includes('process is not defined')) return 'process_not_defined';
  if (m.includes('provider') && m.includes('context')) return 'provider_context';
  if (m.includes('cannot find module') || m.includes('module not found') || m.includes('failed to resolve')) {
    return 'module_missing';
  }
  if (m.includes('unexpected token') || m.includes('syntaxerror') || m.includes('parse error')) {
    return 'syntax';
  }
  return 'other';
}
