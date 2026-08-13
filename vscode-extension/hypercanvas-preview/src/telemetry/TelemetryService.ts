/**
 * TelemetryService — the central host-side telemetry seam.
 *
 * WHAT: owns config reading, gating, the common-prop bag, a PII guard, an
 * in-memory buffer + periodic flush, and the `vscode.env.createTelemetryLogger`
 * wiring. All product code calls `track()` / `trackError()`; this class decides
 * whether to send (gating) and routes to the PostHog/Sentry `TelemetrySender`.
 * HOW REACHED: constructed once in `extension.ts` `activate()`, stored in a
 * module-level `let telemetry`, and threaded into commands / bridges / providers.
 * Webview code never imports this — it posts `telemetry:event` messages that the
 * panel routers forward to `track()`.
 * INVARIANTS:
 *   - Constructs and runs safely with NO keys and with telemetry disabled (ships
 *     safe). Never throws on missing keys.
 *   - Sends ONLY when `vscode.env.isTelemetryEnabled === true` AND
 *     `hypercanvas.telemetry.enabled !== false`. Both are live-tracked via the
 *     `onDidChangeTelemetryEnabled` / `onDidChangeConfiguration` listeners. We
 *     never read the raw `telemetry.telemetryLevel` string.
 * PII RULE: every prop must be an enum/count/duration/boolean/hash. `scrubProps`
 *   strips anything that looks like a path/url/long free-form string. Use
 *   `hashString()` for any message derived from user/source content.
 */

import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { type HandledErrorWhere, type TelemetryProps, type TelemetryValue, WEBVIEW_ALLOWED_EVENTS } from './events';
import { createTelemetrySender, type TelemetrySender } from './sender';

const CONFIG_SECTION = 'hypercanvas.telemetry';
const FLUSH_INTERVAL_MS = 30000;

/**
 * Truncate a sha256 hex digest — enough to dedupe, too short to reverse.
 * The documented PII-scrubbing API for event emitters: the PII RULE in
 * events.ts instructs callers to send `hashString(message)` instead of raw
 * user/source-derived strings.
 * @public
 */
export function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export interface TrackErrorContext {
  where: HandledErrorWhere;
  severity?: 'fatal' | 'error' | 'warning';
}

/**
 * Minimal telemetry surface for code that forwards webview-origin events AND
 * emits host-origin events (panel routers, panels, providers). Implemented by
 * `TelemetryService`. Keeping it narrow avoids pulling the whole service type
 * into webview-adjacent modules. `track` is host-origin (no allow-list);
 * `trackFromWebview` is allow-list-gated for webview-posted events.
 */
export interface TelemetrySink {
  track(name: string, props?: TelemetryProps): void;
  trackFromWebview(name: string, props?: TelemetryProps): void;
}

/**
 * Narrow view of the `vscode` APIs `TelemetryService` touches. A default
 * implementation reads the real `vscode` namespace; tests pass a fake. This is
 * how we stay testable WITHOUT `mock.module('vscode', ...)` (the shared preload
 * warns that overriding the vscode module leaks across test files).
 */
export interface TelemetryVscodeAdapter {
  isTelemetryEnabled(): boolean;
  machineId: string;
  sessionId: string;
  getConfigValue<T>(key: string, defaultValue: T): T;
  createLogger(sender: TelemetrySender): vscode.TelemetryLogger;
  onTelemetryEnabledChange(cb: () => void): vscode.Disposable;
  onConfigChange(cb: (affects: (section: string) => boolean) => void): vscode.Disposable;
}

/** Injection seam for tests — supply a fake sender and/or vscode adapter. */
export interface TelemetryServiceDeps {
  senderFactory?: typeof createTelemetrySender;
  vscodeAdapter?: TelemetryVscodeAdapter;
}

/** Default adapter that reads the real `vscode` namespace (production path). */
function defaultVscodeAdapter(): TelemetryVscodeAdapter {
  return {
    isTelemetryEnabled: () => vscode.env.isTelemetryEnabled === true,
    machineId: vscode.env.machineId,
    sessionId: vscode.env.sessionId,
    getConfigValue: <T>(key: string, defaultValue: T): T =>
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key, defaultValue),
    createLogger: (sender) => vscode.env.createTelemetryLogger(sender, { ignoreUnhandledErrors: true }),
    onTelemetryEnabledChange: (cb) => vscode.env.onDidChangeTelemetryEnabled(() => cb()),
    onConfigChange: (cb) =>
      vscode.workspace.onDidChangeConfiguration((e) => cb((section) => e.affectsConfiguration(section))),
  };
}

export class TelemetryService {
  private readonly context: vscode.ExtensionContext;
  private readonly vsc: TelemetryVscodeAdapter;
  private readonly sender: TelemetrySender;
  private readonly logger: vscode.TelemetryLogger;
  private readonly commonProps: TelemetryProps;
  private readonly disposables: vscode.Disposable[] = [];

  /** Live gate flag — flipped by the env/config change listeners. */
  private settingEnabled: boolean;
  /**
   * True when at least one backend key (PostHog or Sentry) was configured at
   * construction. When false the whole pipeline is inert (no network ever),
   * regardless of the enabled gate — used to suppress the first-run notice so we
   * never tell a user "we collect telemetry" while nothing is actually sent.
   */
  private readonly backendConfigured: boolean;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(context: vscode.ExtensionContext, deps: TelemetryServiceDeps = {}) {
    this.context = context;
    this.vsc = deps.vscodeAdapter ?? defaultVscodeAdapter();
    const cfg = this.readConfig();
    this.settingEnabled = cfg.settingEnabled;
    this.backendConfigured = Boolean(cfg.posthogKey) || Boolean(cfg.sentryDsn);

    // Hash the VS Code machine/session ids before they reach any backend or
    // event prop. Hashing keeps them stable (usable as analytics keys) while
    // honoring the "one-way hashes only" privacy contract — no reversible
    // stable fingerprint ever leaves the process.
    const distinctId = hashString(this.vsc.machineId);
    const sessionHash = hashString(this.vsc.sessionId);

    const factory = deps.senderFactory ?? createTelemetrySender;
    this.sender = factory({
      posthogKey: cfg.posthogKey,
      posthogHost: cfg.posthogHost,
      sentryDsn: cfg.sentryDsn,
      distinctId,
      release: cfg.extVersion,
    });

    this.commonProps = {
      machineId: distinctId,
      sessionId: sessionHash,
      extVersion: cfg.extVersion,
    };

    this.logger = this.vsc.createLogger(this.sender);
    this.disposables.push(this.logger);

    this.subscribeToGateChanges();
    this.startFlushTimer();
  }

  // --- config + gating ---------------------------------------------------

  private readConfig(): {
    settingEnabled: boolean;
    posthogKey: string | undefined;
    posthogHost: string;
    sentryDsn: string | undefined;
    extVersion: string;
  } {
    const env = process.env;
    const orEnv = (val: string | undefined, envVal: string | undefined): string | undefined =>
      val && val.length > 0 ? val : envVal && envVal.length > 0 ? envVal : undefined;

    const extVersion = (this.context.extension?.packageJSON?.version as string | undefined) ?? '0.0.0';

    return {
      settingEnabled: this.vsc.getConfigValue<boolean>('enabled', true) !== false,
      posthogKey: orEnv(this.vsc.getConfigValue<string>('posthogKey', ''), env.HYPERCANVAS_POSTHOG_KEY),
      posthogHost:
        orEnv(this.vsc.getConfigValue<string>('posthogHost', ''), env.HYPERCANVAS_POSTHOG_HOST) ??
        'https://eu.i.posthog.com',
      sentryDsn: orEnv(this.vsc.getConfigValue<string>('sentryDsn', ''), env.HYPERCANVAS_SENTRY_DSN),
      extVersion,
    };
  }

  /** True only when both VS Code global telemetry AND our setting are on. */
  isEnabled(): boolean {
    return this.vsc.isTelemetryEnabled() === true && this.settingEnabled === true;
  }

  /**
   * True when at least one backend (PostHog/Sentry) key was configured. False =>
   * the pipeline is inert and sends nothing no matter the enabled gate. Callers
   * use this to avoid surfacing telemetry UX (the first-run notice) before any
   * data is actually collected.
   */
  hasActiveBackend(): boolean {
    return this.backendConfigured;
  }

  private subscribeToGateChanges(): void {
    this.disposables.push(
      this.vsc.onTelemetryEnabledChange(() => {
        // VS Code flag changed; isEnabled() recomputes from the adapter directly.
      }),
      this.vsc.onConfigChange((affects) => {
        if (affects(`${CONFIG_SECTION}.enabled`)) {
          this.settingEnabled = this.vsc.getConfigValue<boolean>('enabled', true) !== false;
        }
      }),
    );
  }

  // --- PII guard ---------------------------------------------------------

  /**
   * Strip any property whose value looks like a path, URL, or long free-form
   * string. Numbers/booleans pass through; short enum-ish strings pass through.
   * This is a defense-in-depth net, NOT a license to pass raw user strings.
   */
  private scrubProps(props: TelemetryProps | undefined): TelemetryProps {
    const out: TelemetryProps = {};
    if (!props) return out;
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'number' || typeof value === 'boolean') {
        out[key] = value;
        continue;
      }
      if (typeof value === 'string' && this.isSafeString(value)) {
        out[key] = value;
      }
      // Anything else (objects, unsafe strings) is dropped silently.
    }
    return out;
  }

  private isSafeString(value: string): boolean {
    if (value.length > 64) return false;
    if (value.includes('/') || value.includes('\\')) return false;
    if (value.includes('://') || value.includes(' ')) return false;
    return true;
  }

  // --- public API --------------------------------------------------------

  /** Emit a product-analytics event (gated, scrubbed, common-props merged). */
  track(name: string, props?: TelemetryProps): void {
    if (this.disposed || !this.isEnabled()) return;
    const merged = { ...this.commonProps, ...this.scrubProps(props) };
    try {
      this.logger.logUsage(name, merged);
    } catch {
      // never throw from telemetry
    }
  }

  /**
   * Forward an event that originated in a webview. Only allow-listed names are
   * accepted so a buggy/compromised webview can't inject arbitrary events.
   */
  trackFromWebview(name: string, props?: TelemetryProps): void {
    if (!WEBVIEW_ALLOWED_EVENTS.has(name)) return;
    this.track(name, props);
  }

  /** Route an error to Sentry and emit an `error.*` usage event. */
  trackError(err: unknown, ctx: TrackErrorContext): void {
    if (this.disposed || !this.isEnabled()) return;
    const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Unknown error');
    try {
      this.logger.logError(error, {
        where: ctx.where,
        severity: ctx.severity ?? 'error',
        errorName: error.name,
      });
    } catch {
      // never throw from telemetry
    }
  }

  /** Hashing helper exposed so callers can scrub messages before `track()`. */
  hash(input: string): string {
    return hashString(input);
  }

  // --- buffer / flush / lifecycle ---------------------------------------

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    // Do not keep the host process alive solely for the flush timer.
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  /** Flush buffered events to both backends. Safe to call any time. */
  async flush(): Promise<void> {
    try {
      await this.sender.flush();
    } catch {
      // never throw from telemetry
    }
  }

  /** Flush + shut down. Call from `deactivate()`. Idempotent. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    try {
      await this.sender.shutdown();
    } catch {
      // never throw from telemetry
    }
  }
}

/**
 * Re-export for callers building props inline.
 * @public
 */
export type { TelemetryValue, TelemetryProps };
