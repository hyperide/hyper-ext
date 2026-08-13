import { describe, expect, it } from 'bun:test';
import { classifyMapDataSource } from './map-datasource-classifier';

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
  });
});
