# React DevTools source-location resolution (React 19) — and our `App.tsx:101:32` residual

Date: 2026-07-14
Context: inspector residual where a React-19 element resolves to a bogus COMPILED
position (`src/App.tsx:101:32`, past the 58-line file's EOF) instead of the real
source. HYP-970 (0.1.70, PR #658/#659) already landed the `_debugStack`→source-map
mapper, but the residual persists — because the leak is on a DIFFERENT path than the
one HYP-970 patched.

## Prior research

No dedicated devtools-source-resolution doc existed before this one. Adjacent work:
- Specs/plans: `docs/specs/2026-03-24-fiber-based-element-tracing.md`,
  `docs/plans/2026-03-25-fiber-based-element-tracing-phase{1,2}.md` (the fiber
  tracing infra, HYP-268) — no DevTools-symbolication study.
- HYP-970 commits (already merged): `0af7e988`, `be2ab143`, `d560624a`, `b97398fb` —
  added the source-map mapper for the `_debugStack` ANCESTOR call-site walk.
- `docs/notes/2026-05-08-shift-enter-divergence.md` — related but a different
  (index-aware parent) concern.

State: this is the first primary-source study of the DevTools approach.

## How React DevTools resolves a fiber's source under React 19 (primary source)

React 19 dropped `_debugSource` (a pre-computed original position set by the Babel
plugin) in favor of `_debugStack` — a `new Error()` captured at the `jsxDEV()` call
site, whose `.stack` holds COMPILED frames (`http://host/src/App.tsx:101:32` under
Vite dev, or `_next/static/chunks/...` under Next). DevTools resolves this in TWO
separated stages, and NEVER treats the parsed compiled frame as a final source.

1. **Store raw, resolve lazily** — `react-devtools-shared/src/backend/fiber/renderer.js`
   stores the fiber's `_debugStack` verbatim at mount (`ownerInstance.source =
   fiber._debugStack`). It is parsed only when the user actually inspects the element
   (PR facebook/react#28351, "lazily define source for fiber based on component
   stacks").

2. **Parse a frame from the stack (compiled)** —
   `backend/utils/parseStackTrace.js`:
   - `extractLocationFromOwnerStack` iterates the OWNER stack **bottom-up**, taking the
     first source-bearing frame → the component's own definition / call site.
   - `extractLocationFromComponentStack` iterates **top-down**.
   - Both return a RAW tuple `[functionName, fileName, lineNumber, columnNumber]`
     straight from the Error stack — a COMPILED position, explicitly NOT yet
     symbolicated.

3. **Symbolicate via source map (compiled → original)** —
   `react-devtools-shared/src/symbolicateSource.js` (`symbolicateSource`), PR
   facebook/react#28471:
   - `fetchFileWithCaching(sourceURL)` fetches the compiled resource,
   - scans its tail for `//# sourceMappingURL=`, resolves the map URL,
   - `fetchFileWithCaching(sourceMapURL)` fetches the map,
   - builds a `SourceMapConsumer` (`react-devtools-shared/src/hooks/SourceMapConsumer`,
     wrapping the `source-map` library) and calls
     `originalPositionFor({lineNumber, columnNumber})` → original `[fn, sourceURL,
     line, column]`.

4. **Unmappable → null, never the compiled position** — when
   `originalPositionFor` yields no entry, `symbolicateSource` returns `null`
   (`if (possiblyURL === null) { return null; }`). DevTools then shows nothing / the
   raw stack for debugging, but **never commits the compiled frame as if it were a
   real source position**. Frame selection prefers the OWNER stack (component
   definition/call site) over the component stack.

The load-bearing rule: **the parsed stack frame is only an INPUT to symbolication,
never an output source.** A compiled position is either mapped to original, or
discarded.

## Our residual — where we violate that rule

The `App.tsx:101:32` commit is NOT the ancestor-walk path HYP-970 fixed. It is the
LEAF source seed on the click path:

- `iframe-resolver.ts resolveClickLocal` seeds `source = getSourceLocationFromDOM(el)`.
- `getSourceLocationFromDOM` (`iframe-utils.ts`) → `findNearestSourceLocation` →
  `readFiberSource` (`fiber-internals.ts`), whose React-19 branch returns
  `parseDebugStack(fiber._debugStack)` — the **RAW COMPILED** `src/App.tsx:101:32`.
- The source-map upgrade is conditional:
  ```
  const smSource = resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber);
  if (smSource) source = smSource;
  else if (source === null) { warm + defer }   // <-- only fires when source is null
  ```
  When the client source map is COLD, `smSource` is `null` AND `source` is the
  non-null raw compiled frame → the `else if (source === null)` warm/defer branch is
  **SKIPPED**. The compiled `src/App.tsx:101:32` proceeds.
- `resolveCallSiteTarget` cannot catch it: the compiled line and the real source share
  the SAME `fileName` (`src/App.tsx` — Vite's `jsxDEV` transform adds lines in-place),
  so `isRenderedFilePath` returns true and it returns `directSource` verbatim at the
  `isFromRenderedFile` early-return. The cross-file guard
  (`callerSource.fileName !== directSource.fileName`) is same-file, so never trips.
- `resolveClickLocal` builds `nodeRef = src/App.tsx:101:32` and commits it. AST lookup
  fails ("Element not found"); the position is past the 58-line EOF.

So HYP-970 hardened the ancestor `_debugStack` walk to use the mapper/skip, but the
LEAF seed still trusts a raw `parseDebugStack` frame — exactly the DevTools
anti-pattern (committing a compiled frame that was never symbolicated).

Same latent leak on the overlay path: `getOwnFiberSourceLocation`
(`fiber-source-index.ts`) also falls back to `parseDebugStack`; it's the last resort
after source maps in `resolveSourceIndexFiberSource`, so it only leaks when maps are
cold, but it's the same class.

## Recommended fix (DevTools-faithful)

Rule to enforce: **a raw React-19 `_debugStack` (compiled) frame must never be
committed as a source — it is only an input to source-map symbolication. If the map
is cold/unmapped, warm + defer + retry, or return null; never emit the compiled
position.** (Mirrors `symbolicateSource` returning null on an unmapped frame.)

Concrete change in `resolveClickLocal` (`iframe-resolver.ts`) — make the DOM seed
untrusted for React 19:

```ts
let source = getSourceLocationFromDOM(element);
const fiber = getFiberFromDOM(element);
// React 19: getSourceLocationFromDOM returns a RAW COMPILED _debugStack frame
// (parseDebugStack), NOT an original position. Only a React-18 _debugSource DOM
// seed is a real source. Treat a React-19 DOM seed as "no trusted source" so the
// warm/defer path runs instead of committing the compiled line.
const domSeedIsCompiled = fiber != null && fiber._debugStack != null && fiber._debugSource == null;
if (fiber !== null) {
  const smSource = resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber);
  if (smSource) {
    source = smSource;                       // mapped original — trust it
  } else if (source === null || domSeedIsCompiled) {
    // existing warm + pendingClick defer branch (kick chunk-map fetch, retry on warm)
    ...
    source = domSeedIsCompiled ? null : source; // drop the compiled seed
  }
}
if (source === null) return null;            // defer to warm-retry, never commit compiled
```

Plus a belt-and-suspenders guard mirroring the existing synthetic-path check: right
before building `nodeRef`, if `source` is still an unmapped React-19 compiled frame
(no `smSource` hit this pass), `deferToWarmRetry(fiber); return null;` instead of
committing.

Because the map is warmed on the deferred pass, `retryPendingClick` re-resolves the
same element once `resolveViaClientSourceMap` has the real original position — so the
user still gets a correct selection ~1 frame later, never a dead `:101:32` nodeRef.

Optional root hardening (broader, coordinate with a7c09239 to avoid churn): tag
`parseDebugStack` results with a `compiled: true` provenance flag (or route all
raw-`_debugStack` reads through a single "needs-symbolication" wrapper) so every
commit site (`resolveClickLocal` nodeRef, `FiberSourceIndex` via
`getOwnFiberSourceLocation`) rejects an un-symbolicated frame by construction, the
way DevTools keeps the raw stack and the symbolicated location as distinct values.

## Primary sources

- `facebook/react` `packages/react-devtools-shared/src/backend/fiber/renderer.js`
  — stores `fiber._debugStack` lazily.
- `.../src/backend/utils/parseStackTrace.js` — `extractLocationFromOwnerStack`
  (bottom-up), `extractLocationFromComponentStack` (top-down); returns raw
  `[fn, file, line, col]`.
- `.../src/symbolicateSource.js` — `symbolicateSource`: fetch resource →
  `//# sourceMappingURL=` → `SourceMapConsumer.originalPositionFor` → original, or
  `null` when unmapped.
- `.../src/hooks/SourceMapConsumer` — wraps the `source-map` library.
- PRs: facebook/react#28351 (lazy source from component stacks),
  facebook/react#28471 (symbolication).
