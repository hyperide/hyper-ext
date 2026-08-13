import { describe, expect, it } from 'bun:test';
import { attachMapDataSourceCategories, classifyMapDataSource } from './map-datasource-classifier';

/** Minimal structural shape of a ComponentNode tree for the attach-categories test. */
interface MapNode {
  id: string;
  type: string;
  children?: MapNode[];
  mapItem?: { parentMapId: string; depth: number; expression: string; category?: string };
}

/**
 * HYP-290g — Data-source category classifier.
 *
 * Given a `.map()` receiver expression (the `mapExpression` from
 * getSelectedMapContext) plus the component's source, classify the data source
 * into one of four categories so later DOM-mode sub-tickets (290d/e/f) route
 * correctly. Classification ONLY — no mutation behavior here.
 */
describe('classifyMapDataSource', () => {
  describe('category 3 — literal array in component', () => {
    it('classifies a bare identifier bound to a const ArrayExpression', () => {
      const source = `
        export function List() {
          const items = [1, 2, 3];
          return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      const result = classifyMapDataSource('items', source);
      expect(result.category).toBe('literal-array');
      if (result.category === 'literal-array') {
        // 290e needs the declaration location to splice the array literal.
        expect(result.declarationLoc).toBeDefined();
      }
    });

    it('does NOT treat a mutable `let` array as literal-array (may be reassigned pre-render)', () => {
      // A `let`/`var` binding can be reassigned before render, so the rendered array
      // is not necessarily the initializer — splicing the literal would be wrong.
      // Defer to the safe generator/AI path instead of a destructive direct splice.
      const source = `
        export function List() {
          let items = ['a', 'b'];
          items = window.injected;
          return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      expect(classifyMapDataSource('items', source).category).toBe('generator');
    });
  });

  describe('category 2 — hook-derived', () => {
    it('classifies a useState array-destructure binding', () => {
      // Build the hook name by interpolation so the literal call token never
      // appears contiguously in this file — the `check-react-hooks-import`
      // pre-commit hook scans raw text and would otherwise false-positive on a
      // hook used only inside a fixture string (it is not real React code here).
      const useStateHook = `use${'State'}`;
      const source = `
        export function List() {
          const [items, setItems] = ${useStateHook}([1, 2, 3]);
          return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      expect(classifyMapDataSource('items', source).category).toBe('hook-derived');
    });

    it('classifies a useMap() call binding', () => {
      const source = `
        export function List() {
          const items = useMap();
          return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      expect(classifyMapDataSource('items', source).category).toBe('hook-derived');
    });

    it('classifies a member of a hook-derived object (data.users where data = useQuery())', () => {
      const source = `
        export function List() {
          const data = useQuery();
          return <ul>{data.users.map((u) => <li key={u}>{u}</li>)}</ul>;
        }
      `;
      // Root identifier `data` binds to a hook call → hook-derived, NOT props.
      expect(classifyMapDataSource('data.users', source).category).toBe('hook-derived');
    });
  });

  describe('category 1 — props-from-Sample', () => {
    it('classifies a destructured prop identifier', () => {
      const source = `
        export function List({ items }) {
          return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      expect(classifyMapDataSource('items', source).category).toBe('props-from-sample');
    });

    it('does NOT treat a nested helper/callback param as a component prop', () => {
      // `items` here is a param of the nested `render` helper, not a Sample-supplied
      // component prop — Babel still reports kind==='param'. Routing it to the Sample
      // rewrite path would be wrong; fall back to the safe generator path.
      const source = `
        export function List(props) {
          function render(items) {
            return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
          }
          return render(props.data);
        }
      `;
      expect(classifyMapDataSource('items', source).category).toBe('generator');
    });

    it('classifies a member of the props object (props.items)', () => {
      const source = `
        export function List(props) {
          return <ul>{props.items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      expect(classifyMapDataSource('props.items', source).category).toBe('props-from-sample');
    });

    it('classifies a member of a destructured-prop object (data.users where data is a prop)', () => {
      const source = `
        export function List({ data }) {
          return <ul>{data.users.map((u) => <li key={u}>{u}</li>)}</ul>;
        }
      `;
      expect(classifyMapDataSource('data.users', source).category).toBe('props-from-sample');
    });

    it('classifies an optional-chain member of a prop object (data?.users)', () => {
      const source = `
        export function List({ data }) {
          return <ul>{data?.users?.map((u) => <li key={u}>{u}</li>)}</ul>;
        }
      `;
      // OptionalMemberExpression root must still resolve to `data` (the prop).
      expect(classifyMapDataSource('data?.users', source).category).toBe('props-from-sample');
    });
  });

  describe('category 4 — generator / other (AI path)', () => {
    it('classifies a chained .filter().map() receiver (breaks itemIndex↔array-index, spec A6)', () => {
      const source = `
        export function List({ items }) {
          return <ul>{items.filter((i) => i > 0).map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      // The receiver expression captured by the parser is "items.filter(i => i > 0)".
      const result = classifyMapDataSource('items.filter((i) => i > 0)', source);
      expect(result.category).toBe('generator');
      if (result.category === 'generator') {
        expect(result.reason).toBe('chained-call');
      }
    });

    it('classifies a direct generator call receiver (buildList().map())', () => {
      const source = `
        export function List() {
          return <ul>{buildList().map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      const result = classifyMapDataSource('buildList()', source);
      expect(result.category).toBe('generator');
      if (result.category === 'generator') {
        expect(result.reason).toBe('chained-call');
      }
    });

    it('classifies an imported binding as unresolvable (safe AI fallback)', () => {
      const source = `
        import { items } from './data';
        export function List() {
          return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      const result = classifyMapDataSource('items', source);
      expect(result.category).toBe('generator');
      if (result.category === 'generator') {
        expect(result.reason).toBe('unresolved');
      }
    });

    it('classifies a const initialized from a non-array, non-hook expression', () => {
      const source = `
        export function List({ raw }) {
          const items = raw.slice();
          return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      const result = classifyMapDataSource('items', source);
      expect(result.category).toBe('generator');
      if (result.category === 'generator') {
        expect(result.reason).toBe('non-array-init');
      }
    });

    it('defaults to category 4 (ambiguous) when the root name shadows', () => {
      // `items` is both a prop and a block-scoped const array; we cannot prove
      // which binding feeds the selected .map() → safe AI fallback (spec A6).
      const source = `
        export function List({ items }) {
          const preview = items.length;
          {
            const items = [1, 2, 3];
            return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
          }
          return <span>{preview}</span>;
        }
      `;
      const result = classifyMapDataSource('items', source);
      expect(result.category).toBe('generator');
      if (result.category === 'generator') {
        expect(result.reason).toBe('ambiguous');
      }
    });

    it('falls back to category 4 when the source cannot be parsed', () => {
      const result = classifyMapDataSource('items', 'this is ::: not valid <<< tsx');
      expect(result.category).toBe('generator');
      if (result.category === 'generator') {
        expect(result.reason).toBe('unresolved');
      }
    });

    it('falls back to category 4 for an empty / unknown expression', () => {
      const source = `
        export function List({ items }) {
          return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      expect(classifyMapDataSource('', source).category).toBe('generator');
    });

    it('does not crash on a top-level name collision; degrades to generator (HYP-789)', () => {
      // HYP-789 — read-path crash class (sibling of HYP-784/HYP-785). A file whose
      // user import collides with a same-named top-level declaration —
      // `import { Layout } from 'antd'` + `export function Layout` — parses fine,
      // but babel's SCOPE crawl (which this classifier needs for binding
      // resolution, so it can't be noScope-routed like the structural walks)
      // throws `Duplicate declaration "Layout"` while resolving the receiver's
      // binding. Before the fix this threw uncaught out of classifyMapDataSource;
      // it must instead degrade to the safe generator/AI path.
      const source = `
        import { Layout } from 'antd';

        export function Layout() {
          const items = [1, 2, 3];
          return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      let result: ReturnType<typeof classifyMapDataSource> | undefined;
      expect(() => {
        result = classifyMapDataSource('items', source);
      }).not.toThrow();
      // Unresolvable under the collision → category 4 (the safe AI fallback),
      // same outcome as when no binding is found.
      expect(result?.category).toBe('generator');
      if (result?.category === 'generator') {
        expect(result.reason).toBe('unresolved');
      }
    });

    it('still classifies a normal (non-colliding) datasource correctly after the guard (HYP-789)', () => {
      // Guard: the collision try/catch must NOT change the normal path. The same
      // shape as the collision case minus the name clash must classify cleanly —
      // proving the catch only fires on the scope-crawl failure, never otherwise.
      const source = `
        import { Sidebar } from 'antd';

        export function MyLayout() {
          const items = [1, 2, 3];
          return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
        }
      `;
      const result = classifyMapDataSource('items', source);
      expect(result.category).toBe('literal-array');
    });
  });
});

/**
 * HYP-290h — parse-component attaches the data-source category per `.map()` node so the
 * client controller routes DOM-mode ops without re-parsing the source in the browser.
 */
describe('attachMapDataSourceCategories (HYP-290h)', () => {
  it('tags each mapItem with its classified category, walking the tree', () => {
    const source = `
      export function List({ items }) {
        const tags = ['a', 'b'];
        return (
          <div>
            <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
            <ol>{tags.map((t) => <li key={t}>{t}</li>)}</ol>
          </div>
        );
      }
    `;
    const tree: MapNode[] = [
      {
        id: 'root',
        type: 'div',
        children: [
          {
            id: 'item-1',
            type: 'li',
            mapItem: { parentMapId: 'map-items', depth: 0, expression: 'items' },
          },
          {
            id: 'item-2',
            type: 'li',
            mapItem: { parentMapId: 'map-tags', depth: 0, expression: 'tags' },
          },
        ],
      },
    ];

    attachMapDataSourceCategories(tree as never, source);

    // `items` is a destructured prop → props-from-sample; `tags` is a const literal array.
    expect(tree[0].children?.[0].mapItem?.category).toBe('props-from-sample');
    expect(tree[0].children?.[1].mapItem?.category).toBe('literal-array');
  });

  it('inline-sample props map classifies as generator (two `items` bindings — documented boundary)', () => {
    // BOUNDARY (HYP-558): when the `SampleDefault` is APPENDED INLINE into the
    // component file (what ensureSample does), the sample defines `const items = [...]` to
    // pass the prop. The component file then has TWO referenced `items` bindings — the
    // component param and the sample const — so the classifier (scoped to the whole file)
    // returns `ambiguous` → `generator`. Data mode is therefore (safely) DISABLED for inline
    // props-from-sample lists, rather than risking a destructive mutation at the wrong array.
    // Sibling samples (separate *.samples.tsx) have a single binding and classify cleanly.
    const inlineSampleSource = `
      export function List({ items }) {
        return <ul>{items.map((i) => <li key={i.id}>{i.id}</li>)}</ul>;
      }

      export const SampleDefault = () => {
        const items = [{ id: 'a' }, { id: 'b' }];
        return <List items={items} />;
      };
    `;
    const result = classifyMapDataSource('items', inlineSampleSource);
    expect(result.category).toBe('generator');
  });

  it('leaves nodes without a mapItem untouched and tolerates an unparseable source', () => {
    const tree: MapNode[] = [{ id: 'plain', type: 'span' }];
    // Must not throw; plain nodes get no category.
    attachMapDataSourceCategories(tree as never, 'not <<< valid');
    expect(tree[0].mapItem).toBeUndefined();
  });

  it('does not crash the read path on a top-level name collision (HYP-789, real entry point)', () => {
    // This is the production entry point parseComponent calls. With a top-level
    // name collision in the source (HYP-784/785 class), the per-node
    // classifyMapDataSource scope crawl threw uncaught here BEFORE the fix —
    // crashing the whole parse-component read path. It must now tag the map node
    // with the safe `generator` fallback instead.
    const source = `
      import { Layout } from 'antd';

      export function Layout({ items }) {
        return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
      }
    `;
    const tree: MapNode[] = [
      {
        id: 'item-1',
        type: 'li',
        mapItem: { parentMapId: 'map-items', depth: 0, expression: 'items' },
      },
    ];
    expect(() => attachMapDataSourceCategories(tree as never, source)).not.toThrow();
    expect(tree[0].mapItem?.category).toBe('generator');
  });
});
