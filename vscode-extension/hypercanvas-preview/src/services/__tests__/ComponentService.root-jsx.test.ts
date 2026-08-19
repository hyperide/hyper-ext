/**
 * @file HYP-1223 — regression coverage for `_findComponentReturnJSX`'s root-JSX
 *       resolution order (`resolveComponentReturnJSX` in ComponentService.ts).
 *
 * Accessed via: the Elements Tree (ComponentService.parseStructure), which walks
 *               the JSX returned by whichever function this resolution picks as
 *               "the" file's component.
 *
 * Bug (pre-fix): whenever a file had no default export, the fallback branch
 * always picked the FIRST PascalCase function/const in raw document order,
 * completely ignoring the file's actual `export { ... }` list. A file that
 * declares a non-exported (or non-primary) helper component textually before
 * its real exported component silently resolved to the wrong root JSX. shadcn's
 * `ui/*.tsx` files (e.g. `card.tsx`) happened to dodge this only because their
 * primary component is always declared first — that's a lucky document-order
 * coincidence, not a property the resolver ever verified.
 *
 * Fix: root-JSX resolution now shares the same export-aware name resolution as
 * `_parseComponent` (HYP-486): default export > named export matching the file's
 * basename > first named export > (only when NO export was detected at all)
 * first PascalCase declaration in document order.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import * as vscode from 'vscode';
import { ComponentService } from '../ComponentService';

const ROOT = '/test-workspace';

function setFileContent(source: string): void {
  (vscode.workspace.fs.readFile as unknown as Mock<() => Promise<Uint8Array>>).mockImplementation(() =>
    Promise.resolve(new TextEncoder().encode(source)),
  );
}

// A helper function is declared FIRST and is NOT exported at all; the real
// exported component (`Card`) is declared second. The pre-fix fallback picked
// the first PascalCase declaration in document order — `Helper`'s `<span>` —
// regardless of what's actually exported.
const helperBeforeSoleExportSource = `
function Helper() {
  return <span>helper</span>;
}
function Card() {
  return <div>card</div>;
}
export { Card };
`;

// shadcn-style multi-export list where the file's basename ("card") matches
// one of several named exports declared via a single ExportNamedDeclaration
// specifier list at the bottom of the file — the real-world shape this bug
// was filed against (dep:bun-tw-shadcn-sample's ui/card.tsx). Each candidate
// returns a distinct native tag so `tree[0].label` unambiguously reveals which
// function's JSX was picked.
const shadcnStyleMultiExportSource = `
function CardHeader() {
  return <header>header</header>;
}
function Card() {
  return <div>card</div>;
}
function CardContent() {
  return <section>content</section>;
}
export { CardHeader, Card, CardContent };
`;

// Same multi-export shape, but the file's basename doesn't match any exported
// name — resolution must fall back to the FIRST EXPORTED name (CardHeader,
// export-list order), never to "first declared" (also CardHeader here, so this
// case alone wouldn't catch a document-order regression — paired with the
// helper-before-sole-export case above, which does).
const noBasenameMatchSource = `
function CardHeader() {
  return <header>header</header>;
}
function CardContent() {
  return <section>content</section>;
}
export { CardHeader, CardContent };
`;

// Review finding (HYP-1223): a PascalCase named export that is NOT a
// function/arrow component (e.g. a context object) is collected as a
// candidate name by `collectExportInfo` and sorts first in the export list,
// but resolving it yields no JSX at all. Resolution must fall through to the
// document-order fallback and find the real component (`Card`) instead of
// degrading to an empty tree.
const nonComponentExportFirstSource = `
export const ThemeContext = createContext(null);
function Card() {
  return <div>card</div>;
}
export { Card };
`;

// Second-round review finding (Fable): `nonComponentExportFirstSource` above
// only proves the non-component fall-through finds SOME component — it
// can't tell "tried the remaining named exports" apart from "fell straight
// to raw document order", because `Card` happens to be first in both orders.
// This fixture separates them: a non-exported `Helper` is declared BETWEEN
// the non-component export and the real component. Document order would hit
// `Helper` first; export-list order (skipping the already-tried
// `ThemeContext`) finds `Card` directly.
const nonComponentExportWithHelperBetweenSource = `
export const ThemeContext = createContext(null);
function Helper() {
  return <span>helper</span>;
}
function Card() {
  return <div>card</div>;
}
export { Card };
`;

describe('ComponentService — root-JSX resolution respects the export list (HYP-1223)', () => {
  let errorSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('picks the exported component, not a non-exported helper declared first', async () => {
    setFileContent(helperBeforeSoleExportSource);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/components/ui/misc.tsx');

    expect(tree.length).toBeGreaterThan(0);
    // Root must be Card's <div>, not Helper's <span> (document-order regression).
    // (TreeNode.label is "<tag> \"<text>\"" for a leaf text child, per tree-adapter.ts.)
    expect(tree[0].label).toBe('div "card"');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('prefers the named export matching the file basename over other exports', async () => {
    setFileContent(shadcnStyleMultiExportSource);
    const service = new ComponentService(ROOT, async () => undefined);

    // Basename "card" matches the `Card` export, not `CardHeader` (declared
    // first) or `CardContent` (declared last).
    const tree = await service.parseStructure('src/components/ui/card.tsx');

    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('div "card"');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the first named export when no export matches the basename', async () => {
    setFileContent(noBasenameMatchSource);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/components/ui/misc.tsx');

    expect(tree.length).toBeGreaterThan(0);
    // First EXPORTED name (CardHeader → <header>), not a doc-order guess.
    expect(tree[0].label).toBe('header "header"');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls through to a real component when the resolved export name is not a function/component', async () => {
    setFileContent(nonComponentExportFirstSource);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/components/ui/misc.tsx');

    // ThemeContext resolves first in export order but isn't a function/arrow
    // component — must NOT degrade to an empty tree, must find Card instead.
    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('div "card"');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('tries the remaining named exports before falling to document order, when the resolved export is a non-component', async () => {
    setFileContent(nonComponentExportWithHelperBetweenSource);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/components/ui/misc.tsx');

    // Must be Card's <div> (the other named export), not Helper's <span> —
    // Helper is declared first in document order but was never exported.
    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('div "card"');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('degrades to an empty tree — never an unrelated helper — when an ANONYMOUS default export yields no JSX', async () => {
    // Second-round review finding (Opus + Fable): an anonymous (or
    // HOC-wrapped) default export has no resolvable name, so a name-gated
    // guard would never catch it and it would fall through to the
    // document-order PascalCase scan, exactly the bug class this fix closes
    // for the named-default case. Must degrade to an empty tree instead of
    // resolving to `Helper`.
    setFileContent(`
      function Helper() { return <span>helper</span>; }
      export default function () { return renderProp(); }
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/App.tsx');

    expect(tree).toEqual([]);
  });

  it('still resolves a default export correctly (non-regression)', async () => {
    setFileContent(`
      function Helper() { return <span>helper</span>; }
      export default function App() { return <main>app</main>; }
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/App.tsx');

    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('main "app"');
  });

  it('degrades to an empty tree — never an unrelated helper — when the resolved DEFAULT export yields no JSX', async () => {
    // review finding: the named-export fall-through must NOT apply to a
    // resolved default export. `App`'s body has no directly-extractable JSX
    // return, so this must resolve to an empty tree, not fall through to
    // `Helper`'s <span> (an unrelated, non-exported declaration).
    setFileContent(`
      function Helper() { return <span>helper</span>; }
      export default function App() { return renderProp(); }
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/App.tsx');

    expect(tree).toEqual([]);
  });

  it('still falls back to the first PascalCase declaration when nothing is exported at all (degenerate file)', async () => {
    setFileContent(`
      function First() { return <span>first</span>; }
      function Second() { return <p>second</p>; }
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/Weird.tsx');

    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('span "first"');
  });

  it('resolves an anonymous default-exported function directly', async () => {
    setFileContent(`
      function Helper() { return <span>helper</span>; }
      export default function () { return <main>anon-fn</main>; }
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/App.tsx');

    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('main "anon-fn"');
  });

  it('resolves an anonymous default-exported arrow function with an expression body', async () => {
    setFileContent(`
      function Helper() { return <span>helper</span>; }
      export default () => <main>arrow-expr</main>;
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/App.tsx');

    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('main "arrow-expr"');
  });

  it('resolves an anonymous default-exported arrow function with a block body', async () => {
    setFileContent(`
      function Helper() { return <span>helper</span>; }
      export default () => { return <main>arrow-block</main>; };
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/App.tsx');

    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('main "arrow-block"');
  });

  it('resolves a HOC-wrapped default export to the wrapped component (e.g. `export default memo(App)`)', async () => {
    setFileContent(`
      function App() { return <main>hoc-wrapped</main>; }
      export default memo(App);
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/App.tsx');

    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('main "hoc-wrapped"');
  });

  it('resolves a nested-HOC-wrapped default export (e.g. `export default memo(forwardRef(App))`)', async () => {
    setFileContent(`
      function App() { return <main>nested-hoc</main>; }
      export default memo(forwardRef(App));
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/App.tsx');

    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('main "nested-hoc"');
  });

  it('resolves a `connect(...)(App)`-style default export', async () => {
    setFileContent(`
      function App() { return <main>connect-hoc</main>; }
      export default connect(mapStateToProps)(App);
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/App.tsx');

    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('main "connect-hoc"');
  });

  it('degrades to an empty tree when a HOC-wrapped default export cannot be unwrapped to a local component', async () => {
    setFileContent(`
      function Helper() { return <span>helper</span>; }
      export default memo(SomeImportedComponent);
    `);
    const service = new ComponentService(ROOT, async () => undefined);

    const tree = await service.parseStructure('src/App.tsx');

    // `SomeImportedComponent` unwraps fine but isn't declared in this file —
    // must degrade to empty, not fall through to the unrelated `Helper`.
    expect(tree).toEqual([]);
  });
});
