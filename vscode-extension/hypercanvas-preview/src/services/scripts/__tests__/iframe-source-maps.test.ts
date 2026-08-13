/**
 * @file Tests for extractClientChunkFrames — the extension's _debugStack frame extractor
 * that decides which frames get client source-map warmed (HYP-1161).
 *
 * Ground truth (conloca QA, 2026-08-01): clicking a component imported from a SYMLINKED
 * workspace package (@conloca/cms-spa → packages/cms-spa, served by Vite from prebuilt
 * dist via /@fs/) collapsed to the host call-site 3/3 times. The fiber's own frame URL —
 * `http://localhost:PORT/@fs/<abs>/packages/cms-spa/dist/ui-*.mjs` — has no `/src/`
 * segment, so it was never extracted, never warmed, and the element inherited the first
 * extractable ANCESTOR frame (the host `<Button/>` call site).
 */

import { describe, expect, it } from 'bun:test';
import { extractClientChunkFrames } from '../iframe-source-maps';

function stackWith(frames: string[]): Error {
  const err = new Error();
  err.stack = ['Error', ...frames.map((f) => `    at ${f}`)].join('\n');
  return err;
}

describe('extractClientChunkFrames', () => {
  it('extracts Vite /@fs/ dist frames for symlinked workspace packages (HYP-1161)', () => {
    // Exact conloca frame pair: the clicked <button>'s own frame inside the workspace
    // package's prebuilt dist, then the host call-site frame.
    const err = stackWith([
      'Button (http://localhost:63310/@fs/Users/ultra/work/repo/packages/cms-spa/dist/ui-Cpvb8-tM.mjs:110:25)',
      'OrgGitIdentityForm (http://localhost:63310/src/app/slots/org-settings/OrgGitIdentityForm.tsx:122:33)',
    ]);
    const frames = extractClientChunkFrames(err);
    expect(frames).toContainEqual({
      url: 'http://localhost:63310/@fs/Users/ultra/work/repo/packages/cms-spa/dist/ui-Cpvb8-tM.mjs',
      line: 110,
      col: 25,
    });
    expect(frames).toContainEqual({
      url: 'http://localhost:63310/src/app/slots/org-settings/OrgGitIdentityForm.tsx',
      line: 122,
      col: 33,
    });
  });

  it('still rejects node_modules frames (React internals, pre-bundled deps)', () => {
    const err = stackWith([
      'jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=abc:192:83)',
      'App (http://localhost:5173/src/App.tsx:10:5)',
    ]);
    const frames = extractClientChunkFrames(err);
    expect(frames).toHaveLength(1);
    expect(frames[0].url).toBe('http://localhost:5173/src/App.tsx');
  });

  it('still extracts Next.js chunk frames and skips non-http frames', () => {
    const err = stackWith([
      'Page (http://localhost:3000/_next/static/chunks/app/page-abc.js:1:100)',
      'render (webpack-internal:///./src/render.tsx:5:3)',
    ]);
    const frames = extractClientChunkFrames(err);
    expect(frames).toHaveLength(1);
    expect(frames[0].url).toContain('_next/static/chunks/');
  });
});
