import { q, quantile, variance, histogram, pivot, zip, pick, omit } from './operators.mjs';
export const invoices = Object.freeze(
  [
    { id: 1, customerId: 7, amount: 100, paid: false, day: 1, tags: ['dev', 'urgent'] },
    { id: 2, customerId: 8, amount: 200, paid: true, day: 1, tags: ['design'] },
    { id: 3, customerId: 7, amount: 50, paid: false, day: 2, tags: ['dev'] },
    { id: 4, customerId: 9, amount: 300, paid: true, day: 2, tags: [] },
    { id: 5, customerId: 8, amount: 150, paid: false, day: 3, tags: ['design', 'urgent'] },
    { id: 6, customerId: null, amount: 200, paid: true, day: 3, tags: ['support'] },
  ].map((r) => Object.freeze({ ...r, tags: Object.freeze(r.tags) })),
);
export const customers = Object.freeze(
  [
    { id: 7, name: 'Acme', country: 'GE' },
    { id: 8, name: 'Beta', country: 'DE' },
    { id: 9, name: 'Coda', country: 'GE' },
  ].map(Object.freeze),
);
const amounts = invoices.map((r) => r.amount),
  ids = invoices.map((r) => r.id);
const nativeQuantile = (a, p) => {
  a = [...a].sort((x, y) => x - y);
  if (!a.length) return null;
  const i = (a.length - 1) * p,
    k = Math.floor(i);
  return a[k] * (1 - (i - k)) + a[Math.ceil(i)] * (i - k);
};
const add = (id, title, family, optimized, reference, note) => ({
  id,
  title,
  family,
  optimized,
  reference,
  note,
  code: optimized.toString(),
  native: reference.toString(),
});
export const cases = [
  add(
    'filter',
    'Unpaid invoices',
    'Selection',
    () =>
      q(invoices)
        .where((r) => !r.paid)
        .select((r) => r.id)
        .toArray(),
    () => invoices.filter((r) => !r.paid).map((r) => r.id),
    'Lazy filter/map, no intermediate result arrays.',
  ),
  add(
    'and',
    'Compound condition',
    'Selection',
    () =>
      q(invoices)
        .where((r) => !r.paid && r.amount >= 100)
        .select((r) => r.id)
        .toArray(),
    () => invoices.filter((r) => !r.paid && r.amount >= 100).map((r) => r.id),
    'An index/bitmap for paid is a planned alternative, not used here.',
  ),
  add(
    'pick',
    'Choose named fields',
    'Reshape',
    () =>
      q(invoices)
        .select((r) => pick(r, ['id', 'amount']))
        .toArray(),
    () => invoices.map(({ id, amount }) => ({ id, amount })),
    'Projection pushdown is valid only while downstream fields remain available.',
  ),
  add(
    'rename',
    'Rename and calculate',
    'Reshape',
    () =>
      q(invoices)
        .select((r) => ({ invoice: r.id, net: r.amount / 100 }))
        .toArray(),
    () => invoices.map((r) => ({ invoice: r.id, net: r.amount / 100 })),
    'Computed projections can be fused; money is integer cents in the source fixture.',
  ),
  add(
    'omit',
    'Remove a column',
    'Reshape',
    () =>
      q(invoices)
        .take(1)
        .select((r) => omit(r, ['tags']))
        .toArray(),
    () => invoices.slice(0, 1).map(({ tags: _tags, ...rest }) => rest),
    'Omitting a field does not make secret data safe to send to a browser initially.',
  ),
  add(
    'flatmap',
    'Flatten invoice tags',
    'Reshape',
    () =>
      q(invoices)
        .flatMap((r) => r.tags.map((tag) => ({ id: r.id, tag })))
        .toArray(),
    () => invoices.flatMap((r) => r.tags.map((tag) => ({ id: r.id, tag }))),
    'Cardinality changes; preserve source and tag order.',
  ),
  add(
    'distinct',
    'Unique tags',
    'Sets',
    () =>
      q(invoices)
        .flatMap((r) => r.tags)
        .distinct()
        .toArray(),
    () => [...new Set(invoices.flatMap((r) => r.tags))],
    'Set/Map use SameValueZero for scalar keys, object identity for objects.',
  ),
  add(
    'sum',
    'Revenue total',
    'Aggregates',
    () => q(invoices).sum((r) => r.amount),
    () => invoices.reduce((s, r) => s + r.amount, 0),
    'Mergeable sum; large integer money needs overflow policy.',
  ),
  add(
    'count',
    'Unpaid count',
    'Aggregates',
    () =>
      q(invoices)
        .where((r) => !r.paid)
        .count(),
    () => invoices.filter((r) => !r.paid).length,
    'An incremental count can update by delta; this reference scans.',
  ),
  add(
    'mean',
    'Mean amount',
    'Statistics',
    () => q(invoices).mean((r) => r.amount),
    () => amounts.reduce((a, b) => a + b, 0) / amounts.length,
    'Mean merges as sum and count, never average of unweighted means.',
  ),
  add(
    'minmax',
    'Smallest/largest amount',
    'Aggregates',
    () =>
      q(amounts).reduce((s, x) => ({ min: Math.min(s.min, x), max: Math.max(s.max, x) }), {
        min: Infinity,
        max: -Infinity,
      }),
    () => ({ min: Math.min(...amounts), max: Math.max(...amounts) }),
    'Deleting the winning value requires a supporting index or recomputation.',
  ),
  add(
    'median',
    'Median amount',
    'Statistics',
    () => quantile(amounts, 0.5),
    () => nativeQuantile(amounts, 0.5),
    'Exact type-7 quantile; sorted reference, not a streaming approximation.',
  ),
  add(
    'p95',
    '95th percentile',
    'Statistics',
    () => quantile(amounts, 0.95),
    () => nativeQuantile(amounts, 0.95),
    'Quantile definition and interpolation are part of the contract.',
  ),
  add(
    'variance',
    'Population variance',
    'Statistics',
    () => variance(amounts),
    () => {
      const m = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      return amounts.reduce((s, x) => s + (x - m) ** 2, 0) / amounts.length;
    },
    'Welford implementation; floating-point comparisons use a stated tolerance.',
  ),
  add(
    'samplevariance',
    'Sample variance',
    'Statistics',
    () => variance(amounts, { sample: true }),
    () => {
      const m = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      return amounts.reduce((s, x) => s + (x - m) ** 2, 0) / (amounts.length - 1);
    },
    'n-1 denominator; fewer than two samples returns null.',
  ),
  add(
    'histogram',
    'Amount buckets',
    'Statistics',
    () => histogram(amounts, [100, 200, 300]),
    () => [
      amounts.filter((x) => x < 100).length,
      amounts.filter((x) => x >= 100 && x < 200).length,
      amounts.filter((x) => x >= 200 && x < 300).length,
      amounts.filter((x) => x >= 300).length,
    ],
    'Lower bound inclusive, upper bound exclusive; binary search over edges.',
  ),
  add(
    'group',
    'Totals per customer',
    'Grouping',
    () =>
      q(invoices)
        .groupBy((r) => r.customerId)
        .select((g) => ({ customer: g.key, total: q(g.rows).sum((r) => r.amount) }))
        .toArray(),
    () => {
      const m = new Map();
      for (const r of invoices) m.set(r.customerId, (m.get(r.customerId) || 0) + r.amount);
      return [...m].map(([customer, total]) => ({ customer, total }));
    },
    'First-seen group order. A compiled aggregate need not retain all group rows.',
  ),
  add(
    'having',
    'Groups over 200 cents',
    'Grouping',
    () =>
      q(invoices)
        .groupBy((r) => r.customerId)
        .select((g) => ({ customer: g.key, total: q(g.rows).sum((r) => r.amount) }))
        .where((g) => g.total > 200)
        .toArray(),
    () => {
      const m = new Map();
      for (const r of invoices) m.set(r.customerId, (m.get(r.customerId) || 0) + r.amount);
      return [...m].map(([customer, total]) => ({ customer, total })).filter((g) => g.total > 200);
    },
    'Post-aggregate filter cannot generally be pushed before aggregation.',
  ),
  add(
    'sort',
    'Amount descending, ID tie-break',
    'Order',
    () =>
      q(invoices)
        .orderBy([
          ['amount', 'desc'],
          ['id', 'asc'],
        ])
        .select((r) => r.id)
        .toArray(),
    () => [...invoices].sort((a, b) => b.amount - a.amount || a.id - b.id).map((r) => r.id),
    'Stable total ordering is also required for reliable pagination.',
  ),
  add(
    'topk',
    'Top three amounts',
    'Order',
    () =>
      q(invoices)
        .orderBy([
          ['amount', 'desc'],
          ['id', 'asc'],
        ])
        .take(3)
        .select((r) => r.id)
        .toArray(),
    () =>
      [...invoices]
        .sort((a, b) => b.amount - a.amount || a.id - b.id)
        .slice(0, 3)
        .map((r) => r.id),
    'Current implementation sorts; O(N log K) heap is a proposed lowering.',
  ),
  add(
    'offset',
    'Second page of two',
    'Pagination',
    () =>
      q(invoices)
        .orderBy([['id', 'asc']])
        .skip(2)
        .take(2)
        .select((r) => r.id)
        .toArray(),
    () =>
      [...invoices]
        .sort((a, b) => a.id - b.id)
        .slice(2, 4)
        .map((r) => r.id),
    'Page position is not entity ID; inserts can shift offset pages.',
  ),
  add(
    'cursor',
    'After (200 cents, ID 2)',
    'Pagination',
    () =>
      q(invoices)
        .where((r) => r.amount > 200 || (r.amount === 200 && r.id > 2))
        .orderBy([
          ['amount', 'asc'],
          ['id', 'asc'],
        ])
        .take(2)
        .select((r) => r.id)
        .toArray(),
    () =>
      invoices
        .filter((r) => r.amount > 200 || (r.amount === 200 && r.id > 2))
        .sort((a, b) => a.amount - b.amount || a.id - b.id)
        .slice(0, 2)
        .map((r) => r.id),
    'Keyset predicate must exactly match ordering and null/collation policy.',
  ),
  add(
    'inner',
    'Invoice + existing customer',
    'Relations',
    () =>
      q(invoices)
        .join(
          customers,
          (r) => r.customerId,
          (c) => c.id,
          { project: (r, c) => ({ id: r.id, name: c.name }) },
        )
        .toArray(),
    () =>
      invoices.flatMap((r) => customers.filter((c) => c.id === r.customerId).map((c) => ({ id: r.id, name: c.name }))),
    'Hash join implemented: O(N+M+output); duplicate matches multiply rows.',
  ),
  add(
    'left',
    'Keep invoices without a customer',
    'Relations',
    () =>
      q(invoices)
        .join(
          customers,
          (r) => r.customerId,
          (c) => c.id,
          { kind: 'left', project: (r, c) => ({ id: r.id, name: c?.name ?? null }) },
        )
        .toArray(),
    () => invoices.map((r) => ({ id: r.id, name: customers.find((c) => c.id === r.customerId)?.name ?? null })),
    'Null keys do not match. Missing relation is represented explicitly.',
  ),
  add(
    'semi',
    'Customers with invoices',
    'Relations',
    () =>
      q(customers)
        .join(
          invoices,
          (c) => c.id,
          (r) => r.customerId,
          { kind: 'semi' },
        )
        .select((c) => c.id)
        .toArray(),
    () => customers.filter((c) => invoices.some((r) => r.customerId === c.id)).map((c) => c.id),
    'Existence only: a customer appears once, not once per invoice.',
  ),
  add(
    'anti',
    'Invoices without a customer',
    'Relations',
    () =>
      q(invoices)
        .join(
          customers,
          (r) => r.customerId,
          (c) => c.id,
          { kind: 'anti' },
        )
        .select((r) => r.id)
        .toArray(),
    () => invoices.filter((r) => !customers.some((c) => c.id === r.customerId)).map((r) => r.id),
    'Useful for orphans, missing references and audit views.',
  ),
  add(
    'keyby',
    'Index customers by ID',
    'Reshape',
    () => [...q(customers).keyBy((c) => c.id)].map(([id, c]) => [id, c.name]),
    () =>
      Object.entries(Object.fromEntries(customers.map((c) => [c.id, c.name]))).map(([id, name]) => [Number(id), name]),
    'This keyBy explicitly uses last-value-wins; strict unique indexing is a separate operator.',
  ),
  add(
    'scan',
    'Running revenue',
    'Window',
    () =>
      q(invoices)
        .scan((total, r) => total + r.amount, 0)
        .toArray(),
    () => invoices.map((_, i) => invoices.slice(0, i + 1).reduce((s, r) => s + r.amount, 0)),
    'Linear scan implemented. General scans are not necessarily parallel associative reductions.',
  ),
  add(
    'window',
    'Three-invoice moving mean',
    'Window',
    () =>
      q(amounts)
        .window(3)
        .select((xs) => q(xs).mean())
        .toArray(),
    () => amounts.slice(2).map((_, i) => amounts.slice(i, i + 3).reduce((a, b) => a + b, 0) / 3),
    'Only complete windows; optimized running sum would avoid rescanning each window.',
  ),
  add(
    'union',
    'Union of selected IDs',
    'Sets',
    () => q([1, 2, 2, 3]).union([3, 4]).toArray(),
    () => [...new Set([1, 2, 2, 3, 3, 4])],
    'Set union, not bag/concat; first occurrence determines order.',
  ),
  add(
    'intersect',
    'Intersection of selected IDs',
    'Sets',
    () => q([1, 2, 2, 3]).intersect([2, 4]).toArray(),
    () => [...new Set([1, 2, 2, 3])].filter((x) => [2, 4].includes(x)),
    'For dense integer domains a bitmap may be preferable.',
  ),
  add(
    'except',
    'Remove selected IDs',
    'Sets',
    () => q([1, 2, 2, 3]).except([2]).toArray(),
    () => [...new Set([1, 2, 2, 3])].filter((x) => x !== 2),
    'Reverse indexes help propagate changes in exclusions.',
  ),
  add(
    'partition',
    'Paid versus unpaid IDs',
    'Selection',
    () =>
      q(invoices)
        .partition((r) => r.paid)
        .map((rows) => rows.map((r) => r.id)),
    () => [invoices.filter((r) => r.paid).map((r) => r.id), invoices.filter((r) => !r.paid).map((r) => r.id)],
    'One traversal instead of two filters.',
  ),
  add(
    'find',
    'First unpaid invoice',
    'Selection',
    () => q(invoices).find((r) => !r.paid).id,
    () => invoices.find((r) => !r.paid).id,
    'Short-circuit; find itself returns undefined on empty input.',
  ),
  add(
    'someevery',
    'Existence and universal check',
    'Selection',
    () => [q(invoices).some((r) => r.amount > 250), q(invoices).every((r) => r.amount >= 0)],
    () => [invoices.some((r) => r.amount > 250), invoices.every((r) => r.amount >= 0)],
    'every(empty)=true and some(empty)=false.',
  ),
  add(
    'zip',
    'Attach rank to IDs',
    'Reshape',
    () =>
      zip(
        ids,
        ids.map((_, i) => i + 1),
      ),
    () => ids.map((id, i) => [id, i + 1]),
    'Zip stops at the shorter input; this is positional, not a join.',
  ),
  add(
    'pivot',
    'Paid/unpaid counts by day',
    'Grouping',
    () =>
      pivot(
        invoices,
        (r) => r.day,
        (r) => r.paid,
        () => 1,
      ),
    () => {
      const days = [...new Set(invoices.map((r) => r.day))];
      return days.map((day) => {
        const rows = invoices.filter((r) => r.day === day),
          keys = [...new Set(rows.map((r) => r.paid))];
        return { key: day, columns: keys.map((k) => [k, rows.filter((r) => r.paid === k).length]) };
      });
    },
    'Dynamic column schema; preserve first-seen row/column ordering.',
  ),
  add(
    'repack',
    'Nested customer summaries',
    'Reshape',
    () =>
      q(customers)
        .select((c) => ({
          id: c.id,
          invoices: q(invoices)
            .where((r) => r.customerId === c.id)
            .select((r) => r.id)
            .toArray(),
        }))
        .toArray(),
    () =>
      customers.map((c) => ({ id: c.id, invoices: invoices.filter((r) => r.customerId === c.id).map((r) => r.id) })),
    'Nested presentation is a projection, not a second authoritative store.',
  ),
];
export function equal(a, b) {
  if (typeof a === 'number' && typeof b === 'number')
    return Object.is(a, b) || Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return Object.is(a, b);
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && equal(a[k], b[k]));
}
export function runCase(id) {
  const c = cases.find((c) => c.id === id);
  if (!c) throw new Error('Unknown case');
  const expected = c.reference(),
    actual = c.optimized();
  if (!equal(actual, expected)) throw new Error(`Result mismatch: ${id}`);
  return { expected, actual };
}
