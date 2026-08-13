import { afterEach, describe, expect, it } from 'bun:test';
import { isTrustedMessageOrigin } from './trusted-message-origin';

const SELF_ORIGIN = typeof location !== 'undefined' ? location.origin : '';

afterEach(() => {
  (globalThis as { __HYPERCANVAS_TRUSTED_ORIGINS__?: string }).__HYPERCANVAS_TRUSTED_ORIGINS__ = undefined;
});

describe('isTrustedMessageOrigin', () => {
  it('trusts the empty-string origin (sandboxed webview frames)', () => {
    expect(isTrustedMessageOrigin({ origin: '' })).toBe(true);
  });

  it('trusts vscode-webview:// origins regardless of uuid', () => {
    expect(isTrustedMessageOrigin({ origin: 'vscode-webview://0c1d2e3f-aaaa-bbbb' })).toBe(true);
    expect(isTrustedMessageOrigin({ origin: 'vscode-webview://another-session' })).toBe(true);
  });

  it('trusts vscode-file:// origins', () => {
    expect(isTrustedMessageOrigin({ origin: 'vscode-file://vscode-app' })).toBe(true);
  });

  it('trusts the page own origin (SaaS ↔ same-origin proxy iframe)', () => {
    if (!SELF_ORIGIN) return; // jsdom-less env: location may be undefined
    expect(isTrustedMessageOrigin({ origin: SELF_ORIGIN })).toBe(true);
  });

  it('rejects an unrelated foreign origin', () => {
    expect(isTrustedMessageOrigin({ origin: 'https://evil.example.com' })).toBe(false);
    expect(isTrustedMessageOrigin({ origin: 'http://attacker.test' })).toBe(false);
  });

  it('honors explicitly-configured extra trusted origins', () => {
    (globalThis as { __HYPERCANVAS_TRUSTED_ORIGINS__?: string }).__HYPERCANVAS_TRUSTED_ORIGINS__ =
      'https://hyperide.ai, https://preview.hyperide.ai';
    expect(isTrustedMessageOrigin({ origin: 'https://hyperide.ai' })).toBe(true);
    expect(isTrustedMessageOrigin({ origin: 'https://preview.hyperide.ai' })).toBe(true);
    expect(isTrustedMessageOrigin({ origin: 'https://not-listed.example.com' })).toBe(false);
  });
});
