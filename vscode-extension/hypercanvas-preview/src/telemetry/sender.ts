/**
 * Telemetry backend wiring — PostHog (product analytics) + Sentry (errors).
 *
 * WHAT: builds a `TelemetrySender` (the `{ sendEventData, sendErrorData, flush }`
 * shape `vscode.env.createTelemetryLogger` expects) that forwards events to
 * PostHog EU and routes exceptions to Sentry EU. Also exposes lifecycle
 * (`flush`, `shutdown`) so `TelemetryService` can drive periodic flushing and
 * graceful teardown.
 * HOW REACHED: constructed once by `TelemetryService` (host-side only). Both
 * SDKs are node-only and get bundled into `out/extension.js` (esbuild
 * platform:'node'); they must NEVER be imported from a webview bundle.
 * INVARIANT: missing PostHog key => PostHog path is inert; missing Sentry DSN =>
 * Sentry path is inert. Construction NEVER throws on missing keys. The node-only
 * SDKs are LAZY-required inside the key-gated builders, so their module bodies
 * (which assume a recent node engine) never execute when no key is configured.
 * Sentry runs shared-host-safe: a private `NodeClient` + `Scope`, NO
 * `Sentry.init()`, and an EXPLICIT minimal integration allow-list (no default
 * integrations) so NO global `process.on` / diagnostics-channel handlers are
 * installed — the extension already owns process-level error capture.
 * PII RULE: defense-in-depth. Event props are already scrubbed upstream in
 * `TelemetryService`. Sentry exceptions (message + stack) bypass that scrubber,
 * so a `beforeSend` hook here strips absolute file paths from the message and
 * every stack frame before the event leaves the process. The Sentry user id and
 * PostHog distinctId are an already-hashed anonymous token (see SenderConfig).
 */

import type * as SentryNode from '@sentry/node';
import type { NodeClient, Scope } from '@sentry/node';
import type * as PostHogNode from 'posthog-node';
import type { PostHog } from 'posthog-node';

/** The minimal `vscode.TelemetrySender`-compatible surface plus lifecycle. */
export interface TelemetrySender {
  /** Forward a product-analytics event to PostHog. */
  sendEventData(eventName: string, data?: Record<string, unknown>): void;
  /** Route an error to Sentry. */
  sendErrorData(error: Error, data?: Record<string, unknown>): void;
  /** Flush buffered events to both backends. */
  flush(): Promise<void>;
  /** Flush + shut down both backends. */
  shutdown(): Promise<void>;
}

export interface SenderConfig {
  posthogKey: string | undefined;
  posthogHost: string;
  sentryDsn: string | undefined;
  /**
   * Anonymous, already-hashed machine token used as the PostHog `distinctId` and
   * the Sentry user id. The caller hashes the raw `machineId` before passing it
   * here, so no reversible stable identifier ever reaches a backend.
   */
  distinctId: string;
  /** Extension version, attached to Sentry events as `release`. */
  release: string;
  /** Severity-2 environment hint (e.g. 'production'); optional. */
  environment?: string;
}

const FLUSH_TIMEOUT_MS = 2000;

/**
 * Strip absolute filesystem paths from a free-form string. Replaces any
 * `/abs/path/...` or `C:\...` run with `<path>` so error messages/stacks routed
 * to Sentry never carry a user's home dir, project path, or filename trail.
 */
function stripPaths(input: string | undefined): string | undefined {
  if (!input) return input;
  return input
    .replace(/(?:[A-Za-z]:)?[\\/][\w.@\-/\\ ]+/g, (m) => (m.includes('/') || m.includes('\\') ? '<path>' : m))
    .slice(0, 1024);
}

/**
 * Lazily load `posthog-node` and construct the client, or `null` when no key.
 * The `require` runs only on the key-present path, so the SDK's module body
 * never executes when telemetry ships without a key.
 */
function makePostHog(cfg: SenderConfig): PostHog | null {
  if (!cfg.posthogKey) return null;
  try {
    // Lazy require: keeps the SDK out of the no-key activation path entirely.
    const { PostHog: PostHogCtor } = require('posthog-node') as typeof PostHogNode;
    return new PostHogCtor(cfg.posthogKey, {
      host: cfg.posthogHost,
      flushAt: 20,
      flushInterval: 30000,
      // We never want a network hiccup to surface in the editor.
      requestTimeout: 10000,
    });
  } catch {
    // SDK init must never crash the host — degrade to inert.
    return null;
  }
}

/**
 * Lazily load `@sentry/node` and construct a private `NodeClient` + bound
 * `Scope`, or `null` when no DSN. We pass an EXPLICIT minimal integration
 * allow-list (NOT the filtered defaults) so none of Sentry's global-hook
 * integrations — `ProcessSession` (process.on 'beforeExit'), `ChildProcess`
 * (diagnostics_channel), the uncaught/unhandled handlers, console patching —
 * are ever installed. A `beforeSend` strips absolute paths from the event.
 */
function makeSentry(cfg: SenderConfig): { client: NodeClient; scope: Scope } | null {
  if (!cfg.sentryDsn) return null;
  try {
    const sentry = require('@sentry/node') as typeof SentryNode;
    const {
      NodeClient,
      Scope,
      defaultStackParser,
      makeNodeTransport,
      inboundFiltersIntegration,
      functionToStringIntegration,
      linkedErrorsIntegration,
    } = sentry;

    // Explicit allow-list of inproc, side-effect-free integrations only. None of
    // these touch process/global state; we deliberately do NOT call
    // getDefaultIntegrations() (whose list installs process.on + channel hooks).
    const integrations = [inboundFiltersIntegration(), functionToStringIntegration(), linkedErrorsIntegration()];

    const client = new NodeClient({
      dsn: cfg.sentryDsn,
      release: cfg.release,
      environment: cfg.environment,
      transport: makeNodeTransport,
      stackParser: defaultStackParser,
      integrations,
      // `defaultIntegrations` isn't in `NodeClientOptions` (that field only applies to the
      // higher-level `Options` type consumed by `Sentry.init()`); constructing `NodeClient`
      // directly with an explicit `integrations` list already means no defaults are added.
      // Errors only — no perf/replay traffic from a local editor.
      tracesSampleRate: 0,
      // PII scrub: strip absolute paths from the message and every stack frame
      // before the event is sent (exception text/stack bypass the upstream
      // prop scrubber).
      beforeSend: (event) => {
        if (event.message) event.message = stripPaths(event.message);
        for (const ex of event.exception?.values ?? []) {
          if (ex.value) ex.value = stripPaths(ex.value);
          for (const frame of ex.stacktrace?.frames ?? []) {
            if (frame.filename) frame.filename = stripPaths(frame.filename);
            if (frame.abs_path) frame.abs_path = stripPaths(frame.abs_path);
            // Local source variables can carry user data — drop them entirely.
            frame.vars = undefined;
          }
        }
        return event;
      },
    });
    client.init();

    const scope = new Scope();
    scope.setClient(client);
    scope.setTag('extension', 'hypercanvas-preview');
    scope.setUser({ id: cfg.distinctId });

    return { client, scope };
  } catch {
    // SDK init must never crash the host — degrade to inert.
    return null;
  }
}

/**
 * Build the `TelemetrySender`. Always returns a usable object; the backends it
 * actually talks to depend on which keys were provided.
 */
export function createTelemetrySender(cfg: SenderConfig): TelemetrySender {
  const posthog = makePostHog(cfg);
  const sentry = makeSentry(cfg);

  function sendEventData(eventName: string, data?: Record<string, unknown>): void {
    if (!posthog) return;
    try {
      posthog.capture({
        distinctId: cfg.distinctId,
        event: eventName,
        properties: data ?? {},
      });
    } catch {
      // Telemetry must never crash the host.
    }
  }

  function sendErrorData(error: Error, data?: Record<string, unknown>): void {
    if (!sentry) return;
    try {
      sentry.scope.captureException(error, {
        captureContext: { extra: data ?? {} },
      });
    } catch {
      // Telemetry must never crash the host.
    }
  }

  async function flush(): Promise<void> {
    const tasks: Array<Promise<unknown>> = [];
    if (posthog) tasks.push(posthog.flush().catch(() => undefined));
    // Sentry's client.flush returns a PromiseLike<boolean> (PromiseBuffer) with
    // no .catch — wrap in Promise.resolve to normalize + swallow.
    if (sentry) tasks.push(Promise.resolve(sentry.client.flush(FLUSH_TIMEOUT_MS)).catch(() => undefined));
    await Promise.all(tasks);
  }

  async function shutdown(): Promise<void> {
    const tasks: Array<Promise<unknown>> = [];
    if (posthog) tasks.push(posthog.shutdown().catch(() => undefined));
    if (sentry) tasks.push(Promise.resolve(sentry.client.close(FLUSH_TIMEOUT_MS)).catch(() => undefined));
    await Promise.all(tasks);
  }

  return { sendEventData, sendErrorData, flush, shutdown };
}
