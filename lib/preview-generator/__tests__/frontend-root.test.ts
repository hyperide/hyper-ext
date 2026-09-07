import { describe, expect, it } from 'bun:test';

import { DEFAULT_FRONTEND_ROOT, detectFrontendRootFromHtml } from '../frontend-root';

describe('detectFrontendRootFromHtml (HYP-1345)', () => {
  it("falls back to 'src' when there is no index.html content at all", () => {
    expect(detectFrontendRootFromHtml('')).toBe(DEFAULT_FRONTEND_ROOT);
  });

  it("falls back to 'src' when no module script names an entry", () => {
    const html = '<html><body><script src="/vendor/analytics.js"></script></body></html>';
    expect(detectFrontendRootFromHtml(html)).toBe(DEFAULT_FRONTEND_ROOT);
  });

  it("detects the conventional '/src/main.tsx' layout", () => {
    const html = '<script type="module" src="/src/main.tsx"></script>';
    expect(detectFrontendRootFromHtml(html)).toBe('src');
  });

  it("detects a non-default root from '/client/main.tsx'", () => {
    const html = '<script type="module" src="/client/main.tsx"></script>';
    expect(detectFrontendRootFromHtml(html)).toBe('client');
  });

  // The regression this module exists for: HyperIDE's own index.html loads
  // `/client/App.tsx`. A `main`-only regex missed it, fell back to a non-existent `src/`,
  // and the preview was patched with the entry-mount shape -> eternal "Loading app…".
  it("detects 'client' from HyperIDE's own '/client/App.tsx' entry", () => {
    const html = '<script type="module" src="/client/App.tsx"></script>';
    expect(detectFrontendRootFromHtml(html)).toBe('client');
  });

  it("detects a non-default root from an '/app/index.jsx' entry", () => {
    const html = '<script type="module" src="/app/index.jsx"></script>';
    expect(detectFrontendRootFromHtml(html)).toBe('app');
  });

  // Tier 3. `getPreviewFilePath` always accepted any entry filename; while this module
  // accepted only `main`/`index`/`app`, the two disagreed for an unconventional name —
  // the preview file was written under one root and resolved under another (HYP-1345).
  it('detects a root from an unconventionally-named entry file', () => {
    const html = '<script type="module" src="/client/entry.tsx"></script>';
    expect(detectFrontendRootFromHtml(html)).toBe('client');
  });

  it('accepts a document-relative `./` entry src', () => {
    const html = '<script type="module" src="./client/App.tsx"></script>';
    expect(detectFrontendRootFromHtml(html)).toBe('client');
  });

  it('does not mistake an absolute CDN URL for a project directory', () => {
    const html = '<script type="module" src="https://cdn.example.com/pkg/main.js"></script>';
    expect(detectFrontendRootFromHtml(html)).toBe(DEFAULT_FRONTEND_ROOT);
  });

  it('ignores an entry with no directory segment', () => {
    const html = '<script type="module" src="/main.tsx"></script>';
    expect(detectFrontendRootFromHtml(html)).toBe(DEFAULT_FRONTEND_ROOT);
  });

  it("still prefers a conventional 'main' entry over an unconventional one", () => {
    const html = [
      '<script type="module" src="/vendor/telemetry.js"></script>',
      '<script type="module" src="/client/main.tsx"></script>',
    ].join('\n');
    expect(detectFrontendRootFromHtml(html)).toBe('client');
  });

  it('matches case-insensitively on the tag and attribute', () => {
    const html = '<SCRIPT TYPE="MODULE" SRC="/Client/App.TSX"></SCRIPT>';
    expect(detectFrontendRootFromHtml(html)).toBe('Client');
  });

  it('ignores non-module scripts that would otherwise match', () => {
    const html = [
      '<script src="/legacy/app.js"></script>',
      '<script type="module" src="/client/App.tsx"></script>',
    ].join('\n');
    expect(detectFrontendRootFromHtml(html)).toBe('client');
  });

  it("prefers a 'main' entry in any dir over an 'app' entry that appears earlier", () => {
    const html = [
      '<script type="module" src="/vendor/app.js"></script>',
      '<script type="module" src="/client/main.tsx"></script>',
    ].join('\n');
    expect(detectFrontendRootFromHtml(html)).toBe('client');
  });

  it("lets a later non-'src' entry win over an earlier '/src/' one in the same tier", () => {
    const html = [
      '<script type="module" src="/src/main.tsx"></script>',
      '<script type="module" src="/client/main.tsx"></script>',
    ].join('\n');
    expect(detectFrontendRootFromHtml(html)).toBe('client');
  });

  it('rejects a traversal segment rather than escaping the project root', () => {
    const html = '<script type="module" src="/../main.tsx"></script>';
    expect(detectFrontendRootFromHtml(html)).toBe(DEFAULT_FRONTEND_ROOT);
  });

  it('rejects a backslash-bearing segment (Windows traversal)', () => {
    const html = '<script type="module" src="/..\\evil/main.tsx"></script>';
    expect(detectFrontendRootFromHtml(html)).toBe(DEFAULT_FRONTEND_ROOT);
  });
});
