/**
 * @file Tests for isFetchableModuleFrameUrl — the _debugStack frame-URL allowlist that
 * decides which frames get source-map warmed (HYP-1161).
 *
 * Ground truth (conloca QA, 2026-08-01): a symlinked workspace package served by Vite
 * from its PREBUILT dist produces frames like
 * `http://localhost:5180/@fs/Users/x/repo/packages/cms-spa/dist/ui-*.mjs` — no `/src/`
 * segment. The extension's frame extractor required `/src/`, so the frame was never
 * warmed and click resolution collapsed to the host call-site.
 */

import { describe, expect, it } from 'bun:test';
import { isFetchableModuleFrameUrl } from './module-frame-url';

describe('isFetchableModuleFrameUrl', () => {
  it('accepts Vite /@fs/ frames for symlinked workspace packages served from dist (HYP-1161)', () => {
    // The exact conloca frame shape: workspace package realpath'ed OUT of node_modules
    // by Vite (preserveSymlinks=false) and served from its prebuilt dist via /@fs/.
    expect(
      isFetchableModuleFrameUrl('http://localhost:5180/@fs/Users/x/repo/packages/cms-spa/dist/ui-Cpvb8-tM.mjs'),
    ).toBe(true);
    // …and the source-served monorepo variant (HYP-443 fixture).
    expect(isFetchableModuleFrameUrl('http://localhost:5173/@fs/Users/x/mono/packages/ui/src/Card.tsx')).toBe(true);
  });

  it('accepts ordinary Vite /src/ frames and Next.js/bun chunk frames', () => {
    expect(isFetchableModuleFrameUrl('http://localhost:5173/src/App.tsx')).toBe(true);
    expect(isFetchableModuleFrameUrl('http://localhost:3000/_next/static/chunks/app/page-abc.js')).toBe(true);
    expect(isFetchableModuleFrameUrl('https://localhost:8080/_bun/client/chunk-123.js')).toBe(true);
  });

  it('accepts the SaaS preview-proxy form (origin + /project-preview/<id>/ prefix)', () => {
    expect(
      isFetchableModuleFrameUrl(
        'http://localhost:8080/project-preview/0a1b2c3d-4e5f-6789-abcd-ef0123456789/src/components/Hero.tsx',
      ),
    ).toBe(true);
  });

  it('rejects node_modules frames (React/bundler internals, pre-bundled deps)', () => {
    expect(
      isFetchableModuleFrameUrl('http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=abc'),
    ).toBe(false);
    // An /@fs/ path can still point INTO node_modules (pnpm layout, preserveSymlinks) —
    // those stay non-fetchable: the browser cannot realpath, and package internals are
    // not editable anyway.
    expect(isFetchableModuleFrameUrl('http://localhost:5173/@fs/Users/x/repo/node_modules/react-dom/index.js')).toBe(
      false,
    );
  });

  it('rejects non-http(s) frame URLs', () => {
    expect(isFetchableModuleFrameUrl('file:///Users/x/repo/src/App.tsx')).toBe(false);
    expect(isFetchableModuleFrameUrl('webpack-internal:///./src/App.tsx')).toBe(false);
    expect(isFetchableModuleFrameUrl('about://React/Server/file:///app/.next/server/chunks/x.js')).toBe(false);
    expect(isFetchableModuleFrameUrl('')).toBe(false);
  });

  it('rejects cross-origin CDN/import-map frames when the preview origin is known (P2)', () => {
    const devServer = 'http://localhost:5173';
    // CDN dependency frames carry no /node_modules/ segment — only the origin check excludes
    // them. A warmed CDN frame either fails its (CORS-blocked) map fetch and poisons resolution
    // of the later first-party frame with a cached null, or maps clicks into dependency
    // internals instead of collapsing to the first-party call site.
    expect(isFetchableModuleFrameUrl('https://esm.sh/react@19.1.0/es2022/react.mjs', devServer)).toBe(false);
    expect(isFetchableModuleFrameUrl('https://unpkg.com/react@19.1.0/cjs/react.development.js', devServer)).toBe(false);
    // A DIFFERENT dev-server port is still cross-origin — only the preview's own server serves
    // fetchable frames.
    expect(isFetchableModuleFrameUrl('http://localhost:9999/src/App.tsx', devServer)).toBe(false);
  });

  it('keeps accepting every same-origin dev-server frame form when the preview origin is known (P2)', () => {
    const devServer = 'http://localhost:5173';
    expect(isFetchableModuleFrameUrl('http://localhost:5173/src/App.tsx', devServer)).toBe(true);
    expect(
      isFetchableModuleFrameUrl('http://localhost:5173/@fs/Users/x/repo/packages/ui/dist/ui-abc.mjs', devServer),
    ).toBe(true);
    // SaaS proxy form: app origin + /project-preview/<id>/ prefix.
    expect(
      isFetchableModuleFrameUrl(
        'http://localhost:8080/project-preview/0a1b2c3d-4e5f-6789-abcd-ef0123456789/src/Hero.tsx',
        'http://localhost:8080',
      ),
    ).toBe(true);
  });

  it('short-circuit: same-origin path URLs are accepted, origin-prefix collisions still rejected', () => {
    const devServer = 'http://localhost:5173';
    // Fast path: origin + '/' prefix — the common frame shape, accepted without a URL parse.
    expect(isFetchableModuleFrameUrl('http://localhost:5173/src/deep/nested/Component.tsx?q=1#f', devServer)).toBe(
      true,
    );
    // Prefix-collision authorities share the origin STRING prefix but not origin + '/'; the
    // parse tie-breaker must still reject them.
    expect(isFetchableModuleFrameUrl('http://localhost:5173.evil.com/src/App.tsx', devServer)).toBe(false);
    expect(isFetchableModuleFrameUrl('http://localhost:5173@evil.com/src/App.tsx', devServer)).toBe(false);
    // Different port is cross-origin even with an identical scheme+host prefix.
    expect(isFetchableModuleFrameUrl('http://localhost:51730/src/App.tsx', devServer)).toBe(false);
  });
});
