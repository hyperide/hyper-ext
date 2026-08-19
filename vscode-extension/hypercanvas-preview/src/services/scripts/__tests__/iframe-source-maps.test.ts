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

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Fiber } from '@shared/element-tracing/fiber-internals';
import {
  clientSourceMapCache,
  extractClientChunkFrames,
  resolveOwnCallSiteSourceMap,
  serverSourceMapCache,
} from '../iframe-source-maps';

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

describe('resolveOwnCallSiteSourceMap — a definitive server MISS falls through to client frames', () => {
  // Codex review finding on HYP-1220: the pre-existing
  // `resolveOwnServerSourceMap(fiber) ?? resolveOwnClientSourceMap(fiber).resolved` chain only
  // ever short-circuited on a real server HIT — a server miss (cached `null`) always fell
  // through to the client lookup via `??`. resolveOwnCallSiteSourceMap must preserve that.
  const SERVER_FILE = '/repo/.next/server/chunks/foo.js';
  const CLIENT_URL = 'http://localhost:5173/src/components/ChatInputBar.tsx';

  beforeEach(() => {
    serverSourceMapCache.clear();
    clientSourceMapCache.clear();
  });
  afterEach(() => {
    serverSourceMapCache.clear();
    clientSourceMapCache.clear();
  });

  function fiberWithFrames(stackLines: string[]): Fiber {
    const err = new Error();
    err.stack = ['Error', ...stackLines.map((f) => `    at ${f}`)].join('\n');
    return { _debugStack: err } as unknown as Fiber;
  }

  it('server frame is a definitive miss (null), client frame is a real hit → returns the client hit', () => {
    serverSourceMapCache.set(`${SERVER_FILE}:1:2`, null); // warmed, unmappable
    clientSourceMapCache.set(`${CLIENT_URL}:8:5`, { fileName: 'src/components/ChatInputBar.tsx', line: 8, column: 5 });
    const fiber = fiberWithFrames([`Server (file://${SERVER_FILE}:1:2)`, `ChatInputBar (${CLIENT_URL}:8:5)`]);

    expect(resolveOwnCallSiteSourceMap(fiber)).toEqual({
      fileName: 'src/components/ChatInputBar.tsx',
      line: 8,
      column: 5,
    });
  });

  it('server frame is a definitive miss, client frame is COLD → returns undefined (still warming), not a false null', () => {
    serverSourceMapCache.set(`${SERVER_FILE}:1:2`, null);
    // Client frame is never cached — still warming.
    const fiber = fiberWithFrames([`Server (file://${SERVER_FILE}:1:2)`, `ChatInputBar (${CLIENT_URL}:8:5)`]);

    expect(resolveOwnCallSiteSourceMap(fiber)).toBeUndefined();
  });

  it('server frame is a definitive miss, no client frames at all → returns null (both sides settled)', () => {
    serverSourceMapCache.set(`${SERVER_FILE}:1:2`, null);
    const fiber = fiberWithFrames([`(file://${SERVER_FILE}:1:2)`]);

    expect(resolveOwnCallSiteSourceMap(fiber)).toBeNull();
  });

  // Review finding on HYP-1220 (3rd-model quorum pass): a fiber's own _debugStack can carry
  // MULTIPLE frames on the same side (server or client). The loop must not let a later
  // cached frame stand in as "this side is settled" while an earlier frame on that same
  // side is still cold — that earlier frame could itself resolve to a hit.
  const SERVER_FILE_2 = '/repo/.next/server/chunks/bar.js';
  const CLIENT_URL_2 = 'http://localhost:5173/src/components/OtherThing.tsx';

  it('[cold, null] same-side: an earlier cold server frame is not skipped past by a later definitive miss', () => {
    // SERVER_FILE:1:2 is never cached (still warming); SERVER_FILE_2:3:4 is a definitive miss.
    serverSourceMapCache.set(`${SERVER_FILE_2}:3:4`, null);
    const fiber = fiberWithFrames([`First (file://${SERVER_FILE}:1:2)`, `Second (file://${SERVER_FILE_2}:3:4)`]);

    // Must NOT be null (a false "settled, no location") — the first frame is still warming.
    expect(resolveOwnCallSiteSourceMap(fiber)).toBeUndefined();
  });

  it('[cold, synthetic] same-side: an earlier cold client frame is not skipped past by a later synthetic-preview hit', () => {
    // CLIENT_URL:8:5 is never cached (still warming); CLIENT_URL_2 resolves to the
    // synthetic preview wrapper — still a "hit" per this function's contract, but must
    // not be returned while the earlier same-side frame is still cold.
    clientSourceMapCache.set(`${CLIENT_URL_2}:1:1`, { fileName: '__canvas_preview__.tsx', line: 1, column: 1 });
    const fiber = fiberWithFrames([`First (${CLIENT_URL}:8:5)`, `Second (${CLIENT_URL_2}:1:1)`]);

    expect(resolveOwnCallSiteSourceMap(fiber)).toBeUndefined();
  });

  it('cross server/client: a cold server frame does not block a definite client HIT from being returned', () => {
    // Server frame never cached (still warming); client frame is a real, definite hit.
    // Server and client frames never both populate for the same fiber in practice, but when
    // they do, a cold server side must not suppress an already-resolved client hit.
    clientSourceMapCache.set(`${CLIENT_URL}:8:5`, { fileName: 'src/components/ChatInputBar.tsx', line: 8, column: 5 });
    const fiber = fiberWithFrames([`Server (file://${SERVER_FILE}:1:2)`, `ChatInputBar (${CLIENT_URL}:8:5)`]);

    expect(resolveOwnCallSiteSourceMap(fiber)).toEqual({
      fileName: 'src/components/ChatInputBar.tsx',
      line: 8,
      column: 5,
    });
  });

  /**
   * Alignment fix (follow-up to the HYP-1220 3rd-model quorum pass): `resolveOwnCallSiteSourceMap`
   * used to have the OPPOSITE cold-frame policy from `classifyOwnClientCallSite`/
   * `classifyOwnServerCallSite` (which `resolveViaClientSourceMap`/`resolveViaServerSourceMap`
   * use for their own ancestor walk, see iframe-resolver.test.ts's "a real hit AFTER a cold
   * frame on the SAME fiber wins" tests) — it bailed to "not definitive" the MOMENT it saw
   * the first uncached frame on a side, so a LATER frame on the SAME side that had already
   * resolved to a real hit was silently ignored. `resolveOwnCallSiteSourceMap` now DELEGATES
   * to the same classifiers, so a same-fiber real hit after a cold frame wins here too.
   */
  it('a real hit AFTER a cold frame on the SAME side (server) wins — no longer stuck at undefined forever', () => {
    const STILL_WARMING_FILE = '/repo/.next/server/chunks/still-warming.js';
    // STILL_WARMING_FILE:1:1 deliberately left uncached (cold).
    serverSourceMapCache.set(`${SERVER_FILE}:8:5`, { fileName: 'src/components/ChatInputBar.tsx', line: 8, column: 5 });
    const fiber = fiberWithFrames([`First (file://${STILL_WARMING_FILE}:1:1)`, `Second (file://${SERVER_FILE}:8:5)`]);

    expect(resolveOwnCallSiteSourceMap(fiber)).toEqual({
      fileName: 'src/components/ChatInputBar.tsx',
      line: 8,
      column: 5,
    });
  });

  it('a real hit AFTER a cold frame on the SAME side (client) wins — no longer stuck at undefined forever', () => {
    const STILL_WARMING_URL = 'http://localhost:5173/src/components/StillWarming.tsx';
    // STILL_WARMING_URL:1:1 deliberately left uncached (cold).
    clientSourceMapCache.set(`${CLIENT_URL}:8:5`, { fileName: 'src/components/ChatInputBar.tsx', line: 8, column: 5 });
    const fiber = fiberWithFrames([`First (${STILL_WARMING_URL}:1:1)`, `Second (${CLIENT_URL}:8:5)`]);

    expect(resolveOwnCallSiteSourceMap(fiber)).toEqual({
      fileName: 'src/components/ChatInputBar.tsx',
      line: 8,
      column: 5,
    });
  });

  /**
   * Review finding on the HYP-1220 follow-up: an untested `[synthetic-hit, cold]` frame
   * ORDER (synthetic hit comes FIRST, the still-warming frame SECOND — the reverse of the
   * `[cold, synthetic]` case above) could in principle reproduce the exact main.tsx-leak
   * shape HYP-1220 exists to close, if a naive implementation let the FIRST-seen synthetic
   * hit short-circuit before noticing the later cold frame. It does not: the classifiers'
   * post-loop `sawCold` check fires regardless of scan order, so this must stay `undefined`
   * (not yet settled) exactly like `[cold, synthetic]` does — a real hit at the still-cold
   * frame, once it warms, could still outrank the synthetic boundary.
   */
  it('[synthetic-hit, cold] same-side ordering: a synthetic hit BEFORE a cold frame still does not settle', () => {
    const SERVER_SYNTHETIC = '/repo/.next/server/chunks/wrapper.js';
    const SERVER_STILL_WARMING = '/repo/.next/server/chunks/still-warming-2.js';
    serverSourceMapCache.set(`${SERVER_SYNTHETIC}:969:31`, {
      fileName: 'src/__canvas_preview__.tsx',
      line: 969,
      column: 31,
    });
    // SERVER_STILL_WARMING:1:1 deliberately left uncached (cold).
    const fiber = fiberWithFrames([
      `Wrapper (file://${SERVER_SYNTHETIC}:969:31)`,
      `StillWarming (file://${SERVER_STILL_WARMING}:1:1)`,
    ]);

    expect(resolveOwnCallSiteSourceMap(fiber)).toBeUndefined();
  });

  /**
   * Regression pin for a real bug caught by this same follow-up fix's own test run: naively
   * delegating to `classifyOwnServerCallSite`/`classifyOwnClientCallSite` (which report
   * `'cold'` for a side with ZERO frames of that kind — correct for the ancestor walk, which
   * must keep climbing) broke the COMMON case here — a Vite-only client fiber has no server
   * frames AT ALL, so the server side must never be able to veto a definitive client-side
   * miss/hit. `'empty'` (present, distinct from `'cold'`) is how the shared classifiers now
   * report "zero frames of this kind" so `resolveOwnCallSiteSourceMap`'s combining logic
   * doesn't treat a structurally-absent side as "still warming" forever.
   */
  it('a client-only fiber (zero server frames) is not stuck cold — client MISS settles to null', () => {
    clientSourceMapCache.set(`${CLIENT_URL}:8:5`, null); // warmed, unresolvable
    const fiber = fiberWithFrames([`ChatInputBar (${CLIENT_URL}:8:5)`]);

    expect(resolveOwnCallSiteSourceMap(fiber)).toBeNull();
  });

  it('a server-only fiber (zero client frames) is not stuck cold — server HIT still resolves', () => {
    serverSourceMapCache.set(`${SERVER_FILE}:1:2`, { fileName: 'src/components/ChatInputBar.tsx', line: 8, column: 5 });
    const fiber = fiberWithFrames([`Server (file://${SERVER_FILE}:1:2)`]);

    expect(resolveOwnCallSiteSourceMap(fiber)).toEqual({
      fileName: 'src/components/ChatInputBar.tsx',
      line: 8,
      column: 5,
    });
  });

  /**
   * Review finding (fresh HYP-1220 follow-up quorum, Opus + Fable independently): a fiber
   * with NO `_debugStack` at all (React 18, or a genuinely bare fiber) has zero frames of
   * EITHER kind — that is 'empty' by the `OwnCallSiteState` contract, not 'cold' ("at least
   * one frame IS PRESENT but still warming"). Before this fix both classifiers returned
   * `'cold'` here, so `resolveOwnCallSiteSourceMap` reported `undefined` ("still warming")
   * FOREVER for such a fiber instead of settling to `null` — there is nothing to ever warm.
   */
  it('a fiber with no _debugStack at all settles to null (empty), not undefined (cold) forever', () => {
    const fiber = { _debugStack: null } as unknown as Fiber;

    expect(resolveOwnCallSiteSourceMap(fiber)).toBeNull();
  });
});
