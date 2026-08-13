/**
 * @file Unit tests for index-aware DOM walk-up used by Shift+Enter parent
 * navigation. Covers the GalleryImage-style nested-component regression
 * (docs/plans/2026-05-08-shift-enter-rect-ralphex-plan.md).
 *
 * Real DOM is provided by happy-dom (see `test/setup.ts` /
 * `bunfig.toml`). We don't simulate React fibers — only the contract between
 * `getSourceKey` (per-element mappedSource) and `findElementsByRef`
 * (index-aware lookup with dedup), which is what the regression hinges on.
 */

import { describe, expect, it } from 'bun:test';
import { type FindTraceableParentDeps, findTraceableParent, type TraceableParentStep } from './find-traceable-parent';

function setupDOM(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function buildDeps(keys: Map<HTMLElement, string>, index: Map<string, HTMLElement[]>): FindTraceableParentDeps {
  return {
    getSourceKey: (el) => keys.get(el) ?? null,
    findElementsByRef: (ref) => index.get(ref) ?? [],
    stopAt: document.body,
  };
}

describe('findTraceableParent', () => {
  it('returns the immediate parent when it is indexed under its own key', () => {
    const root = setupDOM('<section><button><img></button></section>');
    const section = root.querySelector('section') as HTMLElement;
    const button = root.querySelector('button') as HTMLElement;
    const img = root.querySelector('img') as HTMLElement;

    const keys = new Map<HTMLElement, string>([
      [img, 'Gallery.tsx:1021:6'],
      [button, 'Gallery.tsx:1001:4'],
      [section, 'Index.tsx:445:0'],
    ]);
    const index = new Map<string, HTMLElement[]>([
      ['Gallery.tsx:1021:6', [img]],
      ['Gallery.tsx:1001:4', [button]],
      ['Index.tsx:445:0', [section]],
    ]);

    const result = findTraceableParent(img, buildDeps(keys, index));
    expect(result).not.toBeNull();
    expect(result?.element).toBe(button);
    expect(result?.ref).toBe('Gallery.tsx:1001:4');
  });

  it('returns null for an orphan element with no traceable ancestors', () => {
    const root = setupDOM('<div><span></span></div>');
    const span = root.querySelector('span') as HTMLElement;

    // No keys at all — every walked ancestor returns null.
    const deps = buildDeps(new Map(), new Map());

    expect(findTraceableParent(span, deps)).toBeNull();
  });

  it('skips ancestors with no source key and walks further up', () => {
    const root = setupDOM('<section><div class="untraceable"><img></div></section>');
    const section = root.querySelector('section') as HTMLElement;
    const img = root.querySelector('img') as HTMLElement;

    // Intermediate <div> has no source key (e.g. injected by a portal /
    // React.Fragment that isn't a host fiber).
    const keys = new Map<HTMLElement, string>([
      [img, 'Gallery.tsx:1021:6'],
      [section, 'Index.tsx:445:0'],
    ]);
    const index = new Map<string, HTMLElement[]>([
      ['Gallery.tsx:1021:6', [img]],
      ['Index.tsx:445:0', [section]],
    ]);

    const trace: TraceableParentStep[] = [];
    const result = findTraceableParent(img, buildDeps(keys, index), trace);
    expect(result?.element).toBe(section);
    expect(result?.ref).toBe('Index.tsx:445:0');

    // Trace must record both the skip (div: no-ref) and the match (section).
    expect(trace.map((s) => s.kind)).toEqual(['no-ref', 'match']);
  });

  // ─── Regression coverage: GalleryImage-style nested-component dedup ─────
  // FiberSourceIndex dedups via shouldSkipNestedMappedSource — only the
  // OUTERMOST host fiber per mappedSource is registered. The naive walk-up
  // (return any ancestor with a non-null key) lands on the deduped INTERMEDIATE
  // host whose key in the index points at a DIFFERENT outer element (rect on
  // wrong element), or at no element at all (rect vanishes if the outer host
  // was unmounted by HMR).
  describe('regression: index-aware walk-up survives FiberSourceIndex dedup', () => {
    it('skips an intermediate ancestor whose key resolves to a sibling outer host', () => {
      // Two parallel GalleryImage instances rendered from the same JSX site
      // (e.g. a `.map()` row). FiberSourceIndex registers only the OUTER one
      // under K_btn — the inner one is deduped away. Walking up from the
      // inner img must NOT return K_btn (rect would jump to the outer button)
      // — it must continue up to a key whose entry contains the walked-up
      // ancestor itself.
      const root = setupDOM(`
        <section>
          <article id="outer">
            <button id="outer-btn"><img id="outer-img"></button>
          </article>
          <article id="inner">
            <button id="inner-btn"><img id="inner-img"></button>
          </article>
        </section>
      `);
      const section = root.querySelector('section') as HTMLElement;
      const outerArticle = root.querySelector('article#outer') as HTMLElement;
      const innerArticle = root.querySelector('article#inner') as HTMLElement;
      const innerBtn = root.querySelector('button#inner-btn') as HTMLElement;
      const innerImg = root.querySelector('img#inner-img') as HTMLElement;

      // Both <button> instances share the same source key (same JSX site in
      // GalleryImage.tsx). Both <article> wrappers share their own JSX site
      // in Index.tsx (rendered from a `.map()`).
      const keys = new Map<HTMLElement, string>([
        [innerImg, 'Gallery.tsx:1021:6'],
        [innerBtn, 'Gallery.tsx:1001:4'],
        [innerArticle, 'Index.tsx:460:8'],
        [outerArticle, 'Index.tsx:460:8'],
        [section, 'Index.tsx:445:0'],
      ]);
      // FiberSourceIndex stores ONLY the deduped outermost — for K_btn that's
      // the OUTER button (a different DOM element than the one we're walking
      // up from). For K_article that's the OUTER article. For K_section it's
      // the section itself (only one).
      const outerBtn = root.querySelector('button#outer-btn') as HTMLElement;
      const index = new Map<string, HTMLElement[]>([
        ['Gallery.tsx:1021:6', [root.querySelector('img#outer-img') as HTMLElement]],
        ['Gallery.tsx:1001:4', [outerBtn]],
        ['Index.tsx:460:8', [outerArticle]],
        ['Index.tsx:445:0', [section]],
      ]);

      const trace: TraceableParentStep[] = [];
      const result = findTraceableParent(innerImg, buildDeps(keys, index), trace);

      // Naive walk-up would return { innerBtn, K_btn } — the rect overlay
      // would then call findElementsByRef(K_btn) and land on outerBtn (wrong
      // element). Index-aware walk-up skips innerBtn and innerArticle (both
      // deduped away) and lands on section, whose key uniquely identifies it.
      expect(result?.element).toBe(section);
      expect(result?.ref).toBe('Index.tsx:445:0');

      // Trace records the not-indexed skips before the match.
      const kinds = trace.map((s) => s.kind);
      expect(kinds).toEqual(['not-indexed', 'not-indexed', 'match']);
    });

    it('walks past an intermediate ancestor whose key resolves to no element (HMR unmount)', () => {
      // The OUTERMOST host fiber for K_btn was unmounted by HMR between the
      // index build and this walk. findElementsByRef(K_btn) returns []. The
      // naive walk-up would still return K_btn — rect overlay's
      // findElementsByRef(K_btn) returns [] too → rect vanishes (the exact
      // user-reported regression). Index-aware walk-up skips the dead key.
      const root = setupDOM('<section><button><img></button></section>');
      const section = root.querySelector('section') as HTMLElement;
      const button = root.querySelector('button') as HTMLElement;
      const img = root.querySelector('img') as HTMLElement;

      const keys = new Map<HTMLElement, string>([
        [img, 'Gallery.tsx:1021:6'],
        [button, 'Gallery.tsx:1001:4'],
        [section, 'Index.tsx:445:0'],
      ]);
      // Note: K_btn is missing from the index — its outermost host was
      // unmounted, leaving an empty entry that filters away in
      // FiberSourceIndex.findDOMElements (`elements.filter(doc.contains)`).
      const index = new Map<string, HTMLElement[]>([
        ['Gallery.tsx:1021:6', [img]],
        ['Index.tsx:445:0', [section]],
      ]);

      const result = findTraceableParent(img, buildDeps(keys, index));
      // Skip the orphaned button, keep walking, land on section.
      expect(result?.element).toBe(section);
      expect(result?.ref).toBe('Index.tsx:445:0');
    });

    it('returns the NEAREST matching ancestor, not the highest one', () => {
      // Three ancestors all match. Walk-up MUST stop at the first (nearest)
      // to preserve "step into the immediate parent" UX — returning the
      // grandparent would skip a level that the user cannot reach without
      // an intermediate Shift+Enter press.
      const root = setupDOM('<section><article><button><img></button></article></section>');
      const section = root.querySelector('section') as HTMLElement;
      const article = root.querySelector('article') as HTMLElement;
      const button = root.querySelector('button') as HTMLElement;
      const img = root.querySelector('img') as HTMLElement;

      const keys = new Map<HTMLElement, string>([
        [img, 'Gallery.tsx:1021:6'],
        [button, 'Gallery.tsx:1001:4'],
        [article, 'Index.tsx:460:8'],
        [section, 'Index.tsx:445:0'],
      ]);
      const index = new Map<string, HTMLElement[]>([
        ['Gallery.tsx:1021:6', [img]],
        ['Gallery.tsx:1001:4', [button]],
        ['Index.tsx:460:8', [article]],
        ['Index.tsx:445:0', [section]],
      ]);

      const result = findTraceableParent(img, buildDeps(keys, index));
      expect(result?.element).toBe(button);
      expect(result?.ref).toBe('Gallery.tsx:1001:4');
    });

    it('returns null for a detached element with no parentElement chain', () => {
      // Defensive — walk-up's `while (current && …)` guard keeps this safe.
      // Pinning the contract so a future "optimization" that drops the
      // null-check doesn't silently NPE on portal-unmounts.
      const detached = document.createElement('div');
      const result = findTraceableParent(detached, buildDeps(new Map(), new Map()));
      expect(result).toBeNull();
    });

    it('terminates at stopAt without checking it as a candidate', () => {
      // stopAt is the upper bound of the walk; the function must NOT call
      // getSourceKey on stopAt itself even if it would match. Today the
      // walk does `while (current !== deps.stopAt)` — pinning that contract
      // so a refactor doesn't accidentally let the body element be returned.
      const root = setupDOM('<section><img></section>');
      const section = root.querySelector('section') as HTMLElement;
      const img = root.querySelector('img') as HTMLElement;

      const keys = new Map<HTMLElement, string>([
        // Note: section has no key, so the walk would normally proceed up to
        // body. With stopAt=body, it must terminate (return null) without
        // examining body even though body might in some hypothetical world
        // have a key.
        [document.body, 'never:should:run'],
      ]);
      const index = new Map<string, HTMLElement[]>([['never:should:run', [document.body]]]);
      // Stop at section so body is unreachable from this walk.
      const deps: FindTraceableParentDeps = {
        getSourceKey: (el) => keys.get(el) ?? null,
        findElementsByRef: (ref) => index.get(ref) ?? [],
        stopAt: section,
      };

      const result = findTraceableParent(img, deps);
      expect(result).toBeNull();
    });

    it('still works when the immediate parent IS its own indexed entry', () => {
      // Sanity: index-aware check must not break the common case (no dedup
      // collision). Same fixture as the very first test.
      const root = setupDOM('<section><button><img></button></section>');
      const button = root.querySelector('button') as HTMLElement;
      const img = root.querySelector('img') as HTMLElement;

      const keys = new Map<HTMLElement, string>([
        [img, 'Gallery.tsx:1021:6'],
        [button, 'Gallery.tsx:1001:4'],
      ]);
      const index = new Map<string, HTMLElement[]>([
        ['Gallery.tsx:1021:6', [img]],
        // K_btn registered under the actual button — happy path.
        ['Gallery.tsx:1001:4', [button]],
      ]);

      const result = findTraceableParent(img, buildDeps(keys, index));
      expect(result?.element).toBe(button);
    });
  });
});
