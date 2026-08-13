/**
 * @file Component-zoo conformance suite (HYP-1042).
 *
 * Unit-level mirror of the ext-test-projects/component-zoo fixture corpus:
 * each describe block builds mock fiber/DOM trees in one zoo fixture shape
 * (React 18 `_debugSource` AND React 19 `_debugStack` variants) and runs the
 * shared resolvers against the behavior fixtures.manifest.json declares for
 * the matching `data-zoo-id` anchors:
 *
 *   click         → resolveCallSiteTarget (source + itemIndex)
 *   select-parent → findTraceableParent (index-aware DOM walk-up)
 *   drag-source   → resolveDragSource (incl. decorative delegation)
 *   style-write   → FiberSourceIndex round-trip (nodeRef → DOM element[s])
 *
 * Ambiguous cases are pinned as TYPED outcomes (null / fail-safe / documented
 * collapse) — never a silently wrong assertion. Where React 18 and React 19
 * diverge (keyed-fragment itemIndex), both behaviors are pinned explicitly.
 *
 * Positions mirror the zoo manifest where practical (1-based line / 0-based
 * column, Babel JSXElement.loc.start convention).
 */

import { describe, expect, it } from 'bun:test';
import { type DebugSource, type Fiber, FiberTag, findNearestDebugSource } from '../element-tracing/fiber-internals';
import { FiberSourceIndex } from '../element-tracing/fiber-source-index';
import type { SourceLocation } from '../element-tracing/types';
import { resolveDragSource } from './drag-source-resolver';
import { findTraceableParent, type TraceableParentStep } from './find-traceable-parent';
import { resolveCallSiteTarget } from './resolve-source';

/* ─── Fiber/DOM builders ─────────────────────────────────────────── */

function fiber(overrides: Partial<Fiber> = {}): Fiber {
  return {
    tag: FiberTag.HostComponent,
    type: 'div',
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    memoizedProps: {},
    _debugSource: null,
    _debugOwner: null,
    ...overrides,
  };
}

/** React 18 `_debugSource` (columnNumber is 1-based, Babel plugin convention). */
function ds(fileName: string, line: number, col1: number): DebugSource {
  return { fileName, lineNumber: line, columnNumber: col1 };
}

/** React 19 `_debugStack`: internal jsxDEV frame first, then the COMPILED user frame. */
function stack19(compiledFile: string, line: number, col1: number): Error {
  const err = new Error();
  err.stack =
    'Error\n' +
    '    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:10)\n' +
    `    at http://localhost:5173/${compiledFile}:${line}:${col1}`;
  return err;
}

function component(type: string, overrides: Partial<Fiber> = {}): Fiber {
  return fiber({ tag: FiberTag.FunctionComponent, type, ...overrides });
}

/** Fragment fibers (tag 7): hostless, not a component fiber for itemIndex purposes. */
function fragment(overrides: Partial<Fiber> = {}): Fiber {
  return fiber({ tag: 7, type: Symbol.for('react.fragment'), ...overrides });
}

function linkChildren(parent: Fiber, children: Fiber[]): void {
  parent.child = children[0] ?? null;
  children.forEach((child, i) => {
    child.return = parent;
    child.sibling = children[i + 1] ?? null;
  });
}

type MockEl = HTMLElement & { __reactFiber$zoo?: Fiber };

/** Mutable view of a mock element for test-tree wiring (avoids inline cast-at-access). */
type Wiring = { parentElement: MockEl | null; dataset: { key?: string } };

function wire(node: MockEl): Wiring {
  return node as unknown as Wiring;
}

function el(tag: string, attrs: Record<string, string> = {}, children: MockEl[] = []): MockEl {
  const node = {
    tagName: tag.toUpperCase(),
    children,
    parentElement: null,
    getAttribute: (name: string) => attrs[name] ?? null,
  } as unknown as MockEl;
  for (const child of children) wire(child).parentElement = node;
  return node;
}

/** Bind a host fiber to a DOM element both ways (stateNode + __reactFiber$). */
function bind(hostFiber: Fiber, node: MockEl): void {
  hostFiber.stateNode = node;
  node.__reactFiber$zoo = hostFiber;
}

/** Minimal Document for FiberSourceIndex: everything not explicitly dropped is live. */
function mockDoc(): Document {
  const dropped = new Set<unknown>();
  return {
    contains: (node: unknown) => !dropped.has(node),
  } as unknown as Document;
}

const RENDERED_APP = 'src/App.tsx';

/* ─── nested components (zoo: nested.*) ──────────────────────────── */

describe('zoo nested components — depth-independent own source (HYP-1006)', () => {
  // Mirrors NestedComponents.tsx: App → NestedPanel → NestedHeader → header → h3.
  function buildNestedTree(makeSource: (file: string, line: number, col1: number) => Partial<Fiber>): {
    h3: Fiber;
    h3Source: SourceLocation;
  } {
    const h3 = fiber({ type: 'h3', ...makeSource('src/fixtures/NestedComponents.tsx', 12, 7) });
    const header = fiber({ type: 'header', ...makeSource('src/fixtures/NestedComponents.tsx', 11, 5) });
    const nestedHeader = component('NestedHeader', makeSource('src/fixtures/NestedComponents.tsx', 20, 7));
    const panel = fiber({ type: 'section', ...makeSource('src/fixtures/NestedComponents.tsx', 19, 5) });
    const nestedPanel = component('NestedPanel', makeSource(RENDERED_APP, 17, 7));
    const app = component('App');
    linkChildren(header, [h3]);
    linkChildren(nestedHeader, [header]);
    linkChildren(panel, [nestedHeader]);
    linkChildren(nestedPanel, [panel]);
    linkChildren(app, [nestedPanel]);
    return { h3, h3Source: { fileName: 'src/fixtures/NestedComponents.tsx', line: 12, column: 6 } };
  }

  it('React 18: deepest host resolves to its OWN source, never the call site', () => {
    const { h3, h3Source } = buildNestedTree((file, line, col1) => ({ _debugSource: ds(file, line, col1) }));
    const result = resolveCallSiteTarget(h3Source, h3, RENDERED_APP, 0);
    expect(result.source).toEqual(h3Source);
    expect(result.itemIndex).toBe(0);
  });

  it('React 19: mapped own source wins; no ancestor is consulted', () => {
    const { h3, h3Source } = buildNestedTree((file, line, col1) => ({
      _debugStack: stack19(file, line + 40, col1 + 4),
    }));
    // The platform hands the click path the SOURCE-MAPPED original position
    // (the compiled _debugStack frame is never committed — HYP-974).
    const result = resolveCallSiteTarget(h3Source, h3, RENDERED_APP, 0, () => null);
    expect(result.source).toEqual(h3Source);
    expect(result.itemIndex).toBe(0);
  });
});

/* ─── fragments (zoo: frag.*) ────────────────────────────────────── */

describe('zoo fragments — transparent, keyed-fragment itemIndex divergence', () => {
  // Mirrors Fragments.tsx: div.root > [<>(spanA, spanB)</>, Fragment×3(em, strong)].
  function buildFragmentTree(useR18: boolean) {
    const src = (line: number, col1: number): Partial<Fiber> =>
      useR18
        ? { _debugSource: ds('src/fixtures/Fragments.tsx', line, col1) }
        : { _debugStack: stack19('src/fixtures/Fragments.tsx', line + 40, col1 + 4) };
    const spanA = fiber({ type: 'span', ...src(17, 9) });
    const spanB = fiber({ type: 'span', ...src(18, 9) });
    const anonFrag = fragment(src(16, 7));
    linkChildren(anonFrag, [spanA, spanB]);
    const keyedFrags = [0, 1, 2].map(() => fragment(src(21, 10)));
    const rows = keyedFrags.map((frag) => {
      const em = fiber({ type: 'em', ...src(22, 11) });
      const strong = fiber({ type: 'strong', ...src(23, 11) });
      linkChildren(frag, [em, strong]);
      return { em, strong };
    });
    const root = fiber({ type: 'div', ...src(15, 5) });
    linkChildren(root, [anonFrag, ...keyedFrags]);
    return { spanA, spanB, rows, root };
  }

  it('React 18: anonymous-fragment child resolves to own source, itemIndex 0', () => {
    const { spanA } = buildFragmentTree(true);
    const own: SourceLocation = { fileName: 'src/fixtures/Fragments.tsx', line: 17, column: 8 };
    const result = resolveCallSiteTarget(own, spanA, RENDERED_APP, 0);
    expect(result).toEqual({ source: own, itemIndex: 0 });
  });

  it('React 18: keyed-fragment row label keeps per-instance itemIndex', () => {
    const { rows } = buildFragmentTree(true);
    const own: SourceLocation = { fileName: 'src/fixtures/Fragments.tsx', line: 22, column: 10 };
    // All three instances share ONE call site (one nodeRef); the index counts
    // at the repeated keyed-Fragment level: instance 2 → itemIndex 1.
    expect(resolveCallSiteTarget(own, rows[0].em, RENDERED_APP, 0).itemIndex).toBe(0);
    expect(resolveCallSiteTarget(own, rows[1].em, RENDERED_APP, 0).itemIndex).toBe(1);
    expect(resolveCallSiteTarget(own, rows[2].em, RENDERED_APP, 0).itemIndex).toBe(2);
  });

  it('React 19: keyed-fragment row label keeps per-instance itemIndex (counted at the fragment level)', () => {
    // The ancestor item-index walk re-runs sibling counting at every level:
    // the em's own group is a singleton, but the keyed FRAGMENT fibers are
    // direct siblings under the host div sharing one compiled position, so
    // the repeated group is found one level up — React 19 matches React 18.
    const { rows } = buildFragmentTree(false);
    const own: SourceLocation = { fileName: 'src/fixtures/Fragments.tsx', line: 22, column: 10 };
    expect(resolveCallSiteTarget(own, rows[0].em, RENDERED_APP, 0, () => null).itemIndex).toBe(0);
    expect(resolveCallSiteTarget(own, rows[1].em, RENDERED_APP, 0, () => null).itemIndex).toBe(1);
    expect(resolveCallSiteTarget(own, rows[2].em, RENDERED_APP, 0, () => null).itemIndex).toBe(2);
  });
});

/* ─── mapped lists (zoo: lists.*) ────────────────────────────────── */

describe('zoo mapped lists — shared call site + itemIndex', () => {
  // Mirrors MappedLists.tsx flat list: ul > li × 3, one call site (line 29).
  function buildFlatList(useR18: boolean) {
    const src = (line: number, col1: number): Partial<Fiber> =>
      useR18
        ? { _debugSource: ds('src/fixtures/MappedLists.tsx', line, col1) }
        : { _debugStack: stack19('src/fixtures/MappedLists.tsx', line + 60, col1 + 4) };
    const items = [0, 1, 2].map(() => fiber({ type: 'li', ...src(29, 11) }));
    const ul = fiber({ type: 'ul', ...src(27, 7) });
    linkChildren(ul, items);
    return { items, ul };
  }
  const LI_OWN: SourceLocation = { fileName: 'src/fixtures/MappedLists.tsx', line: 29, column: 10 };

  it('React 18: each <li> instance resolves to the shared nodeRef with its own itemIndex', () => {
    const { items } = buildFlatList(true);
    for (let i = 0; i < 3; i++) {
      expect(resolveCallSiteTarget(LI_OWN, items[i], RENDERED_APP, 0)).toEqual({ source: LI_OWN, itemIndex: i });
    }
  });

  it('React 19: raw compiled positions are shared by siblings, so counting stays correct', () => {
    const { items } = buildFlatList(false);
    for (let i = 0; i < 3; i++) {
      expect(resolveCallSiteTarget(LI_OWN, items[i], RENDERED_APP, i, () => null)).toEqual({
        source: LI_OWN,
        itemIndex: i,
      });
    }
  });

  it('React 19 nested map: inner cell index counts within the inner group only', () => {
    // Mirrors MappedLists.tsx grid: tbody > tr × 2, each tr > th + td × 2.
    // Inner <td> call site (line 42) is shared by all 4 cells across both rows.
    const src = (line: number, col1: number): Partial<Fiber> => ({
      _debugStack: stack19('src/fixtures/MappedLists.tsx', line + 60, col1 + 4),
    });
    const rows = [0, 1].map(() => {
      const th = fiber({ type: 'th', ...src(38, 15) });
      const cells = [0, 1].map(() => fiber({ type: 'td', ...src(42, 17) }));
      const tr = fiber({ type: 'tr', ...src(37, 13) });
      linkChildren(tr, [th, ...cells]);
      return { tr, cells };
    });
    const tbody = fiber({ type: 'tbody', ...src(35, 9) });
    linkChildren(
      tbody,
      rows.map((r) => r.tr),
    );

    const CELL_OWN: SourceLocation = { fileName: 'src/fixtures/MappedLists.tsx', line: 42, column: 16 };
    // Row 2, cell 2: the platform-side count (getItemIndexFromDOM) sees only the
    // INNER sibling group → itemIndex 1. The outer row index is NOT recoverable —
    // documented ambiguity pinned here (zoo manifest: lists.cell = 'inner-group').
    const result = resolveCallSiteTarget(CELL_OWN, rows[1].cells[1], RENDERED_APP, 1, () => null);
    expect(result).toEqual({ source: CELL_OWN, itemIndex: 1 });
  });

  it('FiberSourceIndex round-trip: shared key holds every live instance (style-write DOM side)', () => {
    const { items, ul } = buildFlatList(false);
    const doc = mockDoc();
    const nodes = items.map(() => el('li'));
    items.forEach((li, i) => bind(li, nodes[i]));
    const rootUl = el('ul', {}, nodes);
    bind(ul, rootUl);
    const hostRoot = fiber({ tag: FiberTag.HostRoot });
    linkChildren(hostRoot, [ul]);

    // Production always injects a source-map resolver (folded: mapped ??
    // compiled) — the raw _debugStack positions never become index keys.
    const originals = new Map<Fiber, SourceLocation>(items.map((li) => [li, LI_OWN]));
    const index = new FiberSourceIndex(() => hostRoot, doc, {
      resolveFiberSource: (f) => originals.get(f) ?? null,
    });
    expect(index.findDOMElements(LI_OWN)).toEqual(nodes);
    expect(index.findDOMElement(LI_OWN, 2)).toBe(nodes[2]);
  });

  it('FiberSourceIndex dual-alias: component call-site key and host own-source key hit the same element (HYP-897)', () => {
    // App renders <Panel/> (App.tsx:47); Panel renders <div> (Panel.tsx:10).
    const div = fiber({ type: 'div', _debugSource: ds('src/Panel.tsx', 10, 5) });
    const panel = component('Panel', { _debugSource: ds(RENDERED_APP, 47, 7) });
    const hostRoot = fiber({ tag: FiberTag.HostRoot });
    linkChildren(panel, [div]);
    linkChildren(hostRoot, [panel]);
    const node = el('div');
    bind(div, node);

    const index = new FiberSourceIndex(() => hostRoot, mockDoc());
    expect(index.findDOMElements({ fileName: 'src/Panel.tsx', line: 10, column: 4 })).toEqual([node]);
    expect(index.findDOMElements({ fileName: RENDERED_APP, line: 47, column: 6 })).toEqual([node]);
  });

  it('FiberSourceIndex dedup: call-site-collapsed host keeps only the OUTERMOST entry (D4)', () => {
    // mapSource collapses the host's own source to the component call site —
    // the index must NOT register the inner host under the collapsed key.
    const div = fiber({ type: 'div', _debugSource: ds('node_modules/@zoo/ui/Primitive.tsx', 10, 5) });
    const panel = component('Panel', { _debugSource: ds(RENDERED_APP, 47, 7) });
    const hostRoot = fiber({ tag: FiberTag.HostRoot });
    linkChildren(panel, [div]);
    linkChildren(hostRoot, [panel]);
    const node = el('div');
    bind(div, node);

    const callSite: SourceLocation = { fileName: RENDERED_APP, line: 47, column: 6 };
    const collapse = (source: SourceLocation): SourceLocation =>
      source.fileName.includes('node_modules') ? callSite : source;
    const index = new FiberSourceIndex(() => hostRoot, mockDoc(), { mapSource: collapse });

    expect(index.findDOMElements(callSite)).toEqual([node]);
    expect(index.findDOMElements({ fileName: 'node_modules/@zoo/ui/Primitive.tsx', line: 10, column: 4 })).toEqual([]);
  });
});

/* ─── HOC + forwardRef (zoo: hoc.*, fwd.*) ───────────────────────── */

describe('zoo HOC and forwardRef — wrappers never swallow the own source', () => {
  it('HOC: wrapped component internals keep their own editable source', () => {
    // Mirrors WithHoc.tsx: withPanel(PanelBody) — hoc.label is <p> in PanelBody.
    const p = fiber({ type: 'p', _debugSource: ds('src/fixtures/WithHoc.tsx', 25, 7) });
    const article = fiber({ type: 'article', _debugSource: ds('src/fixtures/WithHoc.tsx', 24, 5) });
    const panelBody = component('PanelBody', { _debugSource: ds('src/fixtures/WithHoc.tsx', 14, 18) });
    const shell = fiber({ type: 'div', _debugSource: ds('src/fixtures/WithHoc.tsx', 13, 7) });
    const withPanel = component('WithPanel', { _debugSource: ds('src/fixtures/WithHoc.tsx', 36, 25) });
    linkChildren(article, [p]);
    linkChildren(panelBody, [article]);
    linkChildren(shell, [panelBody]);
    linkChildren(withPanel, [shell]);

    const own: SourceLocation = { fileName: 'src/fixtures/WithHoc.tsx', line: 25, column: 6 };
    expect(resolveCallSiteTarget(own, p, RENDERED_APP, 0)).toEqual({ source: own, itemIndex: 0 });
  });

  it('forwardRef React 18: _debugSource unwraps from type.render', () => {
    // React 18 sets _debugSource on the forwardRef RENDER function, not the fiber.
    const renderSource = ds('src/fixtures/ForwardRefBox.tsx', 13, 22);
    const fwdFiber = fiber({ tag: FiberTag.ForwardRef, type: { render: { _debugSource: renderSource } } });
    const found = findNearestDebugSource(fwdFiber);
    expect(found).toEqual(renderSource);
  });

  it('forwardRef internals index under their own source through the wrapper', () => {
    const span = fiber({ type: 'span', _debugSource: ds('src/fixtures/ForwardRefBox.tsx', 15, 7) });
    const div = fiber({ type: 'div', _debugSource: ds('src/fixtures/ForwardRefBox.tsx', 14, 5) });
    const fwd = fiber({ tag: FiberTag.ForwardRef, type: { render: {} }, _debugSource: ds(RENDERED_APP, 18, 7) });
    const hostRoot = fiber({ tag: FiberTag.HostRoot });
    linkChildren(div, [span]);
    linkChildren(fwd, [div]);
    linkChildren(hostRoot, [fwd]);
    const divNode = el('div');
    bind(div, divNode);

    const index = new FiberSourceIndex(() => hostRoot, mockDoc());
    expect(index.findDOMElements({ fileName: 'src/fixtures/ForwardRefBox.tsx', line: 14, column: 4 })).toEqual([
      divNode,
    ]);
    expect(index.findDOMElements({ fileName: RENDERED_APP, line: 18, column: 6 })).toEqual([divNode]);
  });
});

/* ─── spread + non-forwarding (zoo: spread.*, nonfwd.*) ──────────── */

describe('zoo spread props and non-forwarding component — resolver-neutral shapes', () => {
  it('spread props: the element position is real and resolves to own source', () => {
    const box = fiber({ type: 'div', _debugSource: ds('src/fixtures/SpreadProps.tsx', 17, 5) });
    const own: SourceLocation = { fileName: 'src/fixtures/SpreadProps.tsx', line: 17, column: 4 };
    // Style-write caveat (runtime spread precedence) is a manifest typed-warning,
    // not a resolver concern — click resolution is unaffected by spread.
    expect(resolveCallSiteTarget(own, box, RENDERED_APP, 0)).toEqual({ source: own, itemIndex: 0 });
  });

  it('non-forwarding component: internal host still resolves to its own source', () => {
    const span = fiber({ type: 'span', _debugSource: ds('src/fixtures/NonForwarding.tsx', 22, 7) });
    const card = component('NonForwardingCard', { _debugSource: ds('src/fixtures/NonForwarding.tsx', 27, 10) });
    linkChildren(card, [span]);
    const own: SourceLocation = { fileName: 'src/fixtures/NonForwarding.tsx', line: 22, column: 6 };
    // Click resolution succeeds (own editable source). The style-write no-op
    // risk is a manifest typed-warning on nonfwd.card, not a click failure.
    expect(resolveCallSiteTarget(own, span, RENDERED_APP, 0)).toEqual({ source: own, itemIndex: 0 });
  });
});

/* ─── workspace package (zoo: zoo-ui.*) ──────────────────────────── */

describe('zoo symlinked workspace package — editability decides own-source vs call-site (D2)', () => {
  function buildZooUiTree(buttonSource: Partial<Fiber>) {
    const span = fiber({ type: 'span', ...buttonSource });
    const button = fiber({ type: 'button', ...buttonSource });
    const zooButton = component('ZooButton', { _debugSource: ds('src/fixtures/ZooUiConsumer.tsx', 12, 7) });
    const root = fiber({ type: 'div', _debugSource: ds('src/fixtures/ZooUiConsumer.tsx', 11, 5) });
    linkChildren(button, [span]);
    linkChildren(zooButton, [button]);
    linkChildren(root, [zooButton]);
    return { span, button };
  }

  it('Vite realpath (no node_modules segment): primitive internals resolve to their OWN source', () => {
    const realpath = { _debugSource: ds('packages/zoo-ui/src/Primitive.tsx', 18, 7) };
    const { span } = buildZooUiTree(realpath);
    const own: SourceLocation = { fileName: 'packages/zoo-ui/src/Primitive.tsx', line: 18, column: 6 };
    expect(resolveCallSiteTarget(own, span, RENDERED_APP, 0)).toEqual({ source: own, itemIndex: 0 });
  });

  it('preserved symlink path (node_modules segment): collapses to the editable call site', () => {
    const symlinked = { _debugSource: ds('node_modules/@zoo/ui/src/Primitive.tsx', 18, 7) };
    const { span } = buildZooUiTree(symlinked);
    const own: SourceLocation = { fileName: 'node_modules/@zoo/ui/src/Primitive.tsx', line: 18, column: 6 };
    const result = resolveCallSiteTarget(own, span, RENDERED_APP, 0);
    expect(result.source).toEqual({ fileName: 'src/fixtures/ZooUiConsumer.tsx', line: 12, column: 6 });
  });
});

/* ─── React-19 _debugStack provenance (D3) ───────────────────────── */

describe('zoo React-19 _debugStack provenance — never commit a compiled position', () => {
  const PRIMITIVE_OWN: SourceLocation = { fileName: 'node_modules/@zoo/ui/src/Primitive.tsx', line: 18, column: 6 };

  function buildPrimitiveTree() {
    const span = fiber({ type: 'span', _debugStack: stack19('node_modules/@zoo/ui/src/Primitive.tsx', 58, 11) });
    // The call-site ancestor carries ONLY a React-19 _debugStack at the COMPILED
    // position (line 104 — past the real file's EOF).
    const consumer = component('ZooUiConsumer', {
      _debugStack: stack19('src/fixtures/ZooUiConsumer.tsx', 104, 31),
    });
    linkChildren(consumer, [span]);
    return { span, consumer };
  }

  it('mapper present but cold: unmappable ancestor is SKIPPED, never committed compiled (HYP-970)', () => {
    const { span } = buildPrimitiveTree();
    const result = resolveCallSiteTarget(PRIMITIVE_OWN, span, RENDERED_APP, 0, () => null);
    // The walk cannot improve on the direct source and must NOT fall back to the
    // raw compiled frame (…:104:30). Shared-level contract: direct source survives;
    // the platform's editable-guard turns this into defer-or-null, never a bogus commit.
    expect(result.source).toEqual(PRIMITIVE_OWN);
    expect(result.source.line).not.toBe(104);
  });

  it('mapper present and warm: ancestor resolves to the MAPPED original call site', () => {
    const { span, consumer } = buildPrimitiveTree();
    const mapped: SourceLocation = { fileName: 'src/fixtures/ZooUiConsumer.tsx', line: 12, column: 6 };
    const mapper = (f: Fiber): SourceLocation | null => (f === consumer ? mapped : null);
    const result = resolveCallSiteTarget(PRIMITIVE_OWN, span, RENDERED_APP, 0, mapper);
    expect(result.source).toEqual(mapped);
  });

  it('no mapper (resolver-less path): raw parseDebugStack fallback is the documented degradation', () => {
    const { span } = buildPrimitiveTree();
    // Pinned, not endorsed: without a source-map mapper the React-19 ancestor
    // commits its COMPILED frame (HYP-897 pre-mapper behavior). Both production
    // platforms always thread a mapper; this branch is tests/legacy only.
    const result = resolveCallSiteTarget(PRIMITIVE_OWN, span, RENDERED_APP, 0);
    expect(result.source).toEqual({ fileName: 'src/fixtures/ZooUiConsumer.tsx', line: 104, column: 30 });
  });
});

/* ─── select-parent (zoo: selectParent expectations) ─────────────── */

describe('zoo select-parent — index-aware DOM walk-up', () => {
  function parentDeps(indexed: Map<string, MockEl[]>) {
    return {
      getSourceKey: (node: HTMLElement) => wire(node as MockEl).dataset.key ?? null,
      findElementsByRef: (ref: string) => (indexed.get(ref) ?? []) as HTMLElement[],
      stopAt: el('body'),
    };
  }

  it('fragment child walks to the fragment’s host PARENT (frag.child-a → frag.root)', () => {
    // Fragments leave no DOM node: spanA's DOM parent IS the root div.
    const spanA = el('span');
    const root = el('div', {}, [spanA]);
    wire(root).dataset = { key: 'Fragments.tsx:15:4' };
    const deps = parentDeps(new Map([['Fragments.tsx:15:4', [root]]]));
    const result = findTraceableParent(spanA, deps);
    expect(result).toEqual({ element: root, ref: 'Fragments.tsx:15:4' });
  });

  it('deduped intermediate host is skipped; the indexed outer host wins (D4 bridge)', () => {
    // mid's per-element key is NOT in the index (shouldSkipNestedMappedSource
    // dropped it); outer's key is. The walk must pass through mid.
    const leaf = el('span');
    const mid = el('div', {}, [leaf]);
    const outer = el('section', {}, [mid]);
    wire(mid).dataset = { key: 'App.tsx:20:8' };
    wire(outer).dataset = { key: 'App.tsx:18:6' };
    const deps = parentDeps(new Map([['App.tsx:18:6', [outer]]]));
    const trace: TraceableParentStep[] = [];
    const result = findTraceableParent(leaf, { ...deps, stopAt: el('body') }, trace);
    expect(result).toEqual({ element: outer, ref: 'App.tsx:18:6' });
    expect(trace.map((s) => s.kind)).toEqual(['not-indexed', 'match']);
  });

  it('no indexed ancestor → typed null, never a wrong-element guess', () => {
    const leaf = el('span');
    const orphan = el('div', {}, [leaf]);
    wire(orphan).dataset = { key: 'App.tsx:9:4' };
    const deps = parentDeps(new Map());
    expect(findTraceableParent(leaf, deps)).toBeNull();
  });
});

/* ─── drag-source (zoo: dragSource expectations) ─────────────────── */

describe('zoo drag-source — decorative delegation with provenance-safe fallback', () => {
  const BUTTON_SRC: SourceLocation = { fileName: 'src/fixtures/NestedComponents.tsx', line: 33, column: 6 };

  it('non-decorative element resolves to itself', () => {
    const button = el('button');
    const result = resolveDragSource(button, () => BUTTON_SRC, RENDERED_APP);
    expect(result).toEqual({ source: BUTTON_SRC, el: button });
  });

  it('decorative icon delegates to the non-decorative ancestor (nested.icon → nested.icon-action)', () => {
    const button = el('button');
    const icon = el('span', { 'aria-hidden': 'true' });
    wire(icon).parentElement = button;
    wire(button).parentElement = el('body');
    const result = resolveDragSource(icon, (node) => (node === button ? BUTTON_SRC : null), RENDERED_APP);
    expect(result).toEqual({ source: BUTTON_SRC, el: button });
  });

  it('nested decorative wrappers delegate through ALL aria-hidden layers', () => {
    const button = el('button');
    const wrapA = el('span', { 'aria-hidden': 'true' });
    const wrapB = el('span', { 'aria-hidden': 'true' });
    wire(wrapB).parentElement = wrapA;
    wire(wrapA).parentElement = button;
    wire(button).parentElement = el('body');
    const result = resolveDragSource(wrapB, (node) => (node === button ? BUTTON_SRC : null), RENDERED_APP);
    expect(result).toEqual({ source: BUTTON_SRC, el: button });
  });

  it('decorative + cold source map → typed null (fail-safe, never the raw compiled line)', () => {
    const button = el('button');
    const icon = el('span', { 'aria-hidden': 'true' });
    wire(icon).parentElement = button;
    wire(button).parentElement = el('body');
    // Mapped resolver cold (null) and no fiber fallback: the resolver must
    // return null rather than invent a position (HYP-49).
    const result = resolveDragSource(
      icon,
      () => null,
      RENDERED_APP,
      () => null,
    );
    expect(result).toBeNull();
  });
});
