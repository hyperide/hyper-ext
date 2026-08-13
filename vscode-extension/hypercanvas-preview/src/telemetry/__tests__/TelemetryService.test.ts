/**
 * TelemetryService unit tests.
 *
 * Run with: cd vscode-extension/hypercanvas-preview && bun test src/telemetry/
 *
 * We do NOT call mock.module('vscode', ...) — the shared preload warns that
 * overriding the vscode module leaks across files. Instead we inject a fake
 * vscode adapter and a fake sender, so gating/scrubbing/routing are exercised
 * against real production code with zero network and zero global mock churn.
 */

import { describe, expect, it } from 'bun:test';
import type * as vscode from 'vscode';
import type { TelemetrySender } from '../sender';
import { TelemetryService, type TelemetryVscodeAdapter } from '../TelemetryService';

interface Captured {
  usage: Array<{ name: string; props: Record<string, unknown> }>;
  errors: Array<{ error: Error; props: Record<string, unknown> }>;
  senderEvents: Array<{ name: string; data?: Record<string, unknown> }>;
  senderErrors: Array<{ error: Error }>;
}

function makeFakeLogger(cap: Captured): {
  logUsage: (n: string, p?: Record<string, unknown>) => void;
  logError: (e: Error, p?: Record<string, unknown>) => void;
  dispose: () => void;
} {
  return {
    logUsage: (name, props) => cap.usage.push({ name, props: props ?? {} }),
    logError: (error, props) => cap.errors.push({ error, props: props ?? {} }),
    dispose: () => undefined,
  };
}

function makeFakeSender(cap: Captured): TelemetrySender {
  return {
    sendEventData: (name, data) => cap.senderEvents.push({ name, data }),
    sendErrorData: (error) => cap.senderErrors.push({ error }),
    flush: async () => undefined,
    shutdown: async () => undefined,
  };
}

interface AdapterOpts {
  telemetryEnabled?: boolean;
  config?: Record<string, unknown>;
}

function makeAdapter(cap: Captured, opts: AdapterOpts = {}): TelemetryVscodeAdapter {
  const config = opts.config ?? {};
  return {
    isTelemetryEnabled: () => opts.telemetryEnabled ?? true,
    machineId: 'machine-abc',
    sessionId: 'session-xyz',
    getConfigValue: <T>(key: string, defaultValue: T): T => (key in config ? (config[key] as T) : defaultValue),
    // The fake logger drives our Captured bag directly (logUsage/logError),
    // bypassing the real createTelemetryLogger which would call the sender.
    createLogger: () => makeFakeLogger(cap) as unknown as ReturnType<TelemetryVscodeAdapter['createLogger']>,
    onTelemetryEnabledChange: () => ({ dispose: () => undefined }),
    onConfigChange: () => ({ dispose: () => undefined }),
  };
}

function makeContext(): { extension: { packageJSON: { version: string } } } {
  return { extension: { packageJSON: { version: '9.9.9' } } };
}

function buildService(cap: Captured, adapterOpts: AdapterOpts) {
  return new TelemetryService(
    // Minimal ExtensionContext stub — only `.extension.packageJSON.version` is read.
    makeContext() as unknown as vscode.ExtensionContext,
    {
      vscodeAdapter: makeAdapter(cap, adapterOpts),
      senderFactory: () => makeFakeSender(cap),
    },
  );
}

function emptyCap(): Captured {
  return { usage: [], errors: [], senderEvents: [], senderErrors: [] };
}

describe('TelemetryService gating', () => {
  it('no-ops when VS Code telemetry is disabled', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: false });
    expect(svc.isEnabled()).toBe(false);
    svc.track('session.activated', { activationReason: 'startup' });
    expect(cap.usage).toHaveLength(0);
  });

  it('no-ops when hypercanvas.telemetry.enabled is false', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true, config: { enabled: false } });
    expect(svc.isEnabled()).toBe(false);
    svc.track('session.activated');
    svc.trackError(new Error('boom'), { where: 'preview' });
    expect(cap.usage).toHaveLength(0);
    expect(cap.errors).toHaveLength(0);
  });

  it('is enabled when both VS Code and the setting are on', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true, config: { enabled: true } });
    expect(svc.isEnabled()).toBe(true);
  });
});

describe('TelemetryService backend presence', () => {
  it('reports no active backend when no keys are configured (ships inert)', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    expect(svc.hasActiveBackend()).toBe(false);
  });

  it('reports an active backend when a PostHog key is configured', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true, config: { posthogKey: 'phc_test' } });
    expect(svc.hasActiveBackend()).toBe(true);
  });

  it('reports an active backend when only a Sentry DSN is configured', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true, config: { sentryDsn: 'https://x@sentry.io/1' } });
    expect(svc.hasActiveBackend()).toBe(true);
  });
});

describe('TelemetryService no-op safety', () => {
  it('constructs and tracks without throwing when no keys are present', () => {
    const cap = emptyCap();
    // No posthogKey / sentryDsn in config — sender factory still wired, but the
    // service must construct and run safely regardless.
    const svc = buildService(cap, { telemetryEnabled: true });
    expect(() => svc.track('session.heartbeat', { activeMs: 1000, focused: true })).not.toThrow();
  });

  it('does not attempt a send when disabled (sender untouched)', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: false });
    svc.track('command.invoked', { commandId: 'x', durationMs: 5, outcome: 'ok' });
    expect(cap.usage).toHaveLength(0);
  });
});

describe('TelemetryService track', () => {
  it('emits the right event name + safe props + common props when enabled', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    svc.track('session.activated', { activationReason: 'startup', coldStartMs: 42, hasWorkspace: true });
    expect(cap.usage).toHaveLength(1);
    const ev = cap.usage[0];
    expect(ev.name).toBe('session.activated');
    expect(ev.props.activationReason).toBe('startup');
    expect(ev.props.coldStartMs).toBe(42);
    expect(ev.props.hasWorkspace).toBe(true);
    // common props — machine/session ids are sha256-hashed before they reach any
    // prop (privacy invariant: no reversible stable identifier leaves the process).
    expect(ev.props.machineId).toBe('b24d7aaa950cc2da'); // hashString('machine-abc')
    expect(ev.props.sessionId).toBe('090d29dd6bd25e05'); // hashString('session-xyz')
    expect(ev.props.machineId).not.toBe('machine-abc');
    expect(ev.props.sessionId).not.toBe('session-xyz');
    expect(ev.props.extVersion).toBe('9.9.9');
  });

  it('scrubs PII-ish props (paths, urls, long strings, spaces)', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    svc.track('preview.renderFailed', {
      errorClass: 'runtimeError', // safe enum -> kept
      filePath: '/Users/secret/App.tsx', // path -> dropped
      url: 'https://evil.example/x', // url -> dropped
      message: 'a very long free form sentence that exceeds the safe length limit by a lot really', // dropped
      count: 3, // number -> kept
    });
    const props = cap.usage[0].props;
    expect(props.errorClass).toBe('runtimeError');
    expect(props.count).toBe(3);
    expect(props.filePath).toBeUndefined();
    expect(props.url).toBeUndefined();
    expect(props.message).toBeUndefined();
  });

  it('rejects non-allow-listed webview events but accepts allow-listed ones', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    svc.trackFromWebview('session.activated', {}); // not allow-listed
    expect(cap.usage).toHaveLength(0);
    svc.trackFromWebview('feedback.aiThumb', { responseId: 'r1', score: 1 });
    expect(cap.usage).toHaveLength(1);
    expect(cap.usage[0].name).toBe('feedback.aiThumb');
  });
});

describe('TelemetryService privacy invariant — new instrumented events', () => {
  // Each representative new event carries SAFE props (counts/enums/booleans/hash)
  // plus a deliberately-injected PII-ish prop; the safe props must survive and the
  // PII must be dropped by scrubProps. This is the regression guard against an
  // instrumentation seam accidentally emitting a path / long value string.
  function lastProps(cap: Captured): Record<string, unknown> {
    return cap.usage[cap.usage.length - 1].props;
  }

  it('inspector.propEdited keeps count + valueKind, drops a path/long-value leak', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    svc.track('inspector.propEdited', {
      propCount: 2,
      valueKind: 'string',
      propName: '/Users/secret/App.tsx', // path -> dropped
      propValue: 'a very long free-form className value that exceeds the safe length limit by a lot', // dropped
    });
    const p = lastProps(cap);
    expect(p.propCount).toBe(2);
    expect(p.valueKind).toBe('string');
    expect(p.propName).toBeUndefined();
    expect(p.propValue).toBeUndefined();
  });

  it('inspector.styleEdited keeps styleCount + state, drops a css-value leak', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    svc.track('inspector.styleEdited', {
      styleCount: 3,
      state: 'hover',
      cssValue: 'url(https://evil.example/leak.png)', // url -> dropped
    });
    const p = lastProps(cap);
    expect(p.styleCount).toBe(3);
    expect(p.state).toBe('hover');
    expect(p.cssValue).toBeUndefined();
  });

  it('canvas.elementInserted keeps a short componentType, drops a long/path one', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    svc.track('canvas.elementInserted', { componentType: 'Button' });
    expect(lastProps(cap).componentType).toBe('Button');

    svc.track('canvas.elementInserted', { componentType: '/Users/secret/components/Button.tsx' });
    expect(lastProps(cap).componentType).toBeUndefined(); // path -> dropped
  });

  it('canvas.elementMoved keeps the position enum', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    svc.track('canvas.elementMoved', { position: 'before' });
    expect(lastProps(cap).position).toBe('before');
  });

  it('canvas.elementSelected keeps hashed target + booleans, drops a raw nodeRef path', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    svc.track('canvas.elementSelected', {
      target: 'a1b2c3', // already-hashed opaque token (webview-side) -> kept
      additive: false,
      selectionCount: 1,
      rawRef: 'src/components/Button.tsx:12:4', // path-bearing nodeRef -> dropped
    });
    const p = lastProps(cap);
    expect(p.target).toBe('a1b2c3');
    expect(p.additive).toBe(false);
    expect(p.selectionCount).toBe(1);
    expect(p.rawRef).toBeUndefined();
  });
});

describe('TelemetryService trackError', () => {
  it('routes to the error path with where + errorName', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    svc.trackError(new TypeError('bad thing'), { where: 'aiBridge', severity: 'error' });
    expect(cap.errors).toHaveLength(1);
    expect(cap.errors[0].error).toBeInstanceOf(Error);
    expect(cap.errors[0].props.where).toBe('aiBridge');
    expect(cap.errors[0].props.errorName).toBe('TypeError');
  });

  it('coerces non-Error values into an Error', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    svc.trackError('string failure', { where: 'devServer' });
    expect(cap.errors).toHaveLength(1);
    expect(cap.errors[0].error).toBeInstanceOf(Error);
  });

  it('hash() produces a stable truncated digest', () => {
    const cap = emptyCap();
    const svc = buildService(cap, { telemetryEnabled: true });
    const a = svc.hash('process is not defined');
    const b = svc.hash('process is not defined');
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });
});
