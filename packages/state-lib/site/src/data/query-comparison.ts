/** Authored normalized fixtures, not quotations or substitutes for the production corpus.
 * Every runnable spelling is tested against the same expected result. Unloaded runtimes
 * are references, never silently simulated with a JS implementation. */
export const FIXTURE = {
  rows: [
    { id: 'g1', kind: 'gap', active: true, rank: 8, ownerId: 'u1', amount: 2, position: 0 },
    { id: 'm2', kind: 'message', active: true, rank: 9, ownerId: 'u2', amount: 4, position: 1 },
    { id: 'x1', kind: 'mention', active: false, rank: 10, ownerId: 'missing', amount: 7, position: 2 },
    { id: 'm1', kind: 'message', active: true, rank: 9, ownerId: 'u1', amount: 4, position: 3 },
  ],
  users: [
    { id: 'u1', name: 'Ada' },
    { id: 'u2', name: 'Lin' },
  ],
  excluded: ['gap', 'mention'],
};
export const STAGES = {
  source:
    'Source: the same four rows, in the same order. Datalog additionally needs row identity and an explicit position attribute.',
  filter: 'Predicate: every branch matters. In the gap example, gap survives even when gap itself is excluded.',
  order:
    'Order: rank descending, then id ascending. The id is an explicit tie-breaker; neither set order nor database default order is used.',
  limit: 'Window: take exactly two rows AFTER filtering and sorting, not before.',
  project: 'Output shape: compare projected values, not entities on one side and ids on the other.',
  aggregate: 'Aggregation: each distinct row contributes, even when two rows have the same amount. Empty sum is zero.',
  join: 'Inner join: rows with no matching user are omitted. The original row position determines output order.',
  write:
    'Write contract: new immutable value with one field changed; input unchanged. This is not a query and does not imply persistence or IVM.',
};
export type Stage = keyof typeof STAGES;
export const LANGUAGES = [
  'JavaScript',
  'jq',
  'Lodash',
  'Ramda',
  'Immutable.js',
  'Immer',
  'TanStack DB',
  'Prisma',
  'Drizzle',
  'Datalog',
  'state view (proposal)',
] as const;
export type Language = (typeof LANGUAGES)[number];
export type Variant = {
  lines: { stage: Stage; text: string }[];
  code: string;
  status: 'executable' | 'reference';
  note: string;
  lang: string;
};
export type QueryCase = {
  id: string;
  title: string;
  contract: string;
  expected: unknown;
  variants: Partial<Record<Language, Variant>>;
};
function variant(lines: [Stage, string][], note = '', status: Variant['status'] = 'executable', lang = 'js'): Variant {
  return {
    lines: lines.map(([stage, text]) => ({ stage, text })),
    code: lines.map(([, text]) => text).join('\n'),
    status,
    note,
    lang,
  };
}
export const QUERY_CASES: QueryCase[] = [
  {
    id: 'gap',
    title: 'Filter — keep gaps even when excluded',
    contract:
      'Preserve source order and return an array of ids. No input mutation. Exclusions deliberately contain "gap" to catch the old missing-OR bug.',
    expected: ['g1', 'm2', 'm1'],
    variants: {
      JavaScript: variant([
        ['source', 'const source = rows;'],
        ['filter', "const kept = source.filter(r => r.kind === 'gap' || !excluded.includes(r.kind));"],
        ['project', 'return kept.map(r => r.id);'],
      ]),
      jq: variant(
        [
          ['source', '.excluded as $excluded | .rows'],
          ['filter', '| map(select(.kind == "gap" or (.kind as $kind | $excluded | index($kind) | not)))'],
          ['project', '| map(.id)'],
        ],
        'jq reads the complete fixture as JSON. No jq interpreter is loaded in the browser; this spelling is checked with jq in the test harness.',
        'reference',
        'jq',
      ),
      Lodash: variant([
        ['source', 'const source = _(rows);'],
        ['filter', "const kept = source.filter(r => r.kind === 'gap' || !excluded.includes(r.kind));"],
        ['project', "return kept.map('id').value();"],
      ]),
      Ramda: variant([
        ['source', 'return R.pipe('],
        ['filter', "  R.filter(r => r.kind === 'gap' || !excluded.includes(r.kind)),"],
        ['project', "  R.pluck('id')\n)(rows);"],
      ]),
      'Immutable.js': variant(
        [
          ['source', 'const source = I.List(rows);'],
          ['filter', "const kept = source.filter(r => r.kind === 'gap' || !excluded.includes(r.kind));"],
          ['project', 'return kept.map(r => r.id).toArray();'],
        ],
        'List holds plain row objects here; this is not fromJS/deep Map conversion.',
      ),
      Immer: variant(
        [
          ['source', 'const source = rows;'],
          ['filter', "const kept = source.filter(r => r.kind === 'gap' || !excluded.includes(r.kind));"],
          ['project', 'return kept.map(r => r.id);'],
        ],
        'Reading needs no produce call. This is ordinary JS over an Immer-compatible immutable snapshot.',
      ),
      Datalog: variant(
        [
          ['source', '[:find ?id ?position :in $ ?excluded-set :where'],
          ['filter', ' [?r :row/kind ?kind]\n (or [(= ?kind "gap")]\n     (not [(contains? ?excluded-set ?kind)]))'],
          [
            'project',
            ' [?r :row/id ?id]\n [?r :row/position ?position]]\n;; Host: sort tuples by position, then map first.',
          ],
        ],
        'Datomic-style reference; ingest rows as distinct entities and excluded as a set. Host ordering is REQUIRED to match the array.',
        'reference',
        'clojure',
      ),
      Prisma: variant(
        [
          ['source', 'return prisma.row.findMany({'],
          ['filter', "  where: { OR: [{kind:'gap'}, {kind:{notIn:excluded}}] },"],
          ['order', "  orderBy: {position:'asc'},"],
          ['project', '  select: {id:true}\n}).then(xs => xs.map(r => r.id));'],
        ],
        'Requires a Prisma schema, seeded database and non-null kind. This is a server query, not client IVM.',
        'reference',
        'ts',
      ),
      Drizzle: variant(
        [
          ['source', 'return db.select({id: row.id}).from(row)'],
          ['filter', "  .where(or(eq(row.kind, 'gap'), notInArray(row.kind, excluded)))"],
          ['order', '  .orderBy(asc(row.position))'],
          ['project', '  .then(xs => xs.map(r => r.id));'],
        ],
        'Requires Drizzle table/schema, driver and the same seeded rows. SQL null semantics need an explicit policy.',
        'reference',
        'ts',
      ),
      'TanStack DB': variant(
        [
          ['source', 'const result = await db.queryOnce(q => q.from({r: collection})'],
          ['filter', "  .where(({r}) => db.or(db.eq(r.kind, 'gap'), db.not(db.inArray(r.kind, excluded))))"],
          ['order', "  .orderBy(({r}) => r.position, 'asc')"],
          ['project', '  .select(({r}) => ({id:r.id})));\nreturn result.map(r => r.id);'],
        ],
        'The runner binds db to the installed @tanstack/db module and collection to the local-only fixture. This one-shot result test is not an incremental benchmark.',
      ),
    },
  },
  {
    id: 'top',
    title: 'Filter → stable order → top two → ids',
    contract:
      'Only active rows, rank descending, id ascending on ties, then top two. Same array result in every spelling.',
    expected: ['m1', 'm2'],
    variants: {
      JavaScript: variant([
        ['source', 'const source = rows;'],
        ['filter', 'const active = source.filter(r => r.active);'],
        [
          'order',
          'const sorted = active.toSorted((a,b) => b.rank-a.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));',
        ],
        ['limit', 'const top = sorted.slice(0,2);'],
        ['project', 'return top.map(r => r.id);'],
      ]),
      jq: variant(
        [
          ['source', '.rows'],
          ['filter', '| map(select(.active))'],
          ['order', '| sort_by([-.rank, .id])'],
          ['limit', '| .[:2]'],
          ['project', '| map(.id)'],
        ],
        '',
        'reference',
        'jq',
      ),
      Lodash: variant([
        ['source', 'const source = rows;'],
        ['filter', 'const active = _.filter(source, {active:true});'],
        ['order', "const sorted = _.orderBy(active, ['rank','id'], ['desc','asc']);"],
        ['limit', 'const top = _.take(sorted,2);'],
        ['project', "return _.map(top,'id');"],
      ]),
      Ramda: variant([
        ['source', 'return R.pipe('],
        ['filter', '  R.filter(R.propEq(true, "active")),'],
        ['order', '  R.sortWith([R.descend(R.prop("rank")), R.ascend(R.prop("id"))]),'],
        ['limit', '  R.take(2),'],
        ['project', '  R.pluck("id")\n)(rows);'],
      ]),
      'Immutable.js': variant([
        ['source', 'const source = I.List(rows);'],
        ['filter', 'const active = source.filter(r => r.active);'],
        ['order', 'const sorted = active.sort((a,b) => b.rank-a.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));'],
        ['limit', 'const top = sorted.take(2);'],
        ['project', 'return top.map(r => r.id).toArray();'],
      ]),
      'state view (proposal)': variant(
        [
          ['source', 'const source = view.from(rows);'],
          ['filter', 'const active = source.where({active:true});'],
          ['order', "const sorted = active.orderBy('rank','desc').orderBy('id','asc');"],
          ['limit', 'const top = sorted.take(2);'],
          ['project', "return top.select('id').map(r => r.id);"],
        ],
        'Experimental local facade: immutable inspectable plan, FULL RECOMPUTE. No IVM, persistence or backend pushdown is claimed.',
      ),
      'TanStack DB': variant([
        ['source', 'const result = await db.queryOnce(q => q.from({r: collection})'],
        ['filter', '  .where(({r}) => db.eq(r.active,true))'],
        ['order', "  .orderBy(({r}) => r.rank,'desc').orderBy(({r}) => r.id,'asc')"],
        ['limit', '  .limit(2)'],
        ['project', '  .select(({r}) => ({id:r.id})));\nreturn result.map(r => r.id);'],
      ]),
      Prisma: variant(
        [
          ['source', 'return prisma.row.findMany({'],
          ['filter', '  where:{active:true},'],
          ['order', "  orderBy:[{rank:'desc'},{id:'asc'}],"],
          ['limit', '  take:2,'],
          ['project', '  select:{id:true}\n}).then(xs => xs.map(r => r.id));'],
        ],
        'Requires a database/schema; id collation must agree with this ASCII fixture.',
        'reference',
        'ts',
      ),
      Drizzle: variant(
        [
          ['source', 'return db.select({id:row.id}).from(row)'],
          ['filter', '  .where(eq(row.active,true))'],
          ['order', '  .orderBy(desc(row.rank),asc(row.id))'],
          ['limit', '  .limit(2)'],
          ['project', '  .then(xs => xs.map(r => r.id));'],
        ],
        'Database driver required; ORDER BY must precede LIMIT semantically.',
        'reference',
        'ts',
      ),
      Datalog: variant(
        [
          ['source', '[:find ?id ?rank :in $ :where'],
          ['filter', ' [?r :row/active true]'],
          ['project', ' [?r :row/id ?id] [?r :row/rank ?rank]]'],
          ['order', ';; Host: sort rank DESC, id ASC.'],
          ['limit', ';; Host: take 2, then map tuple id.'],
        ],
        'Core query returns an unordered relation. Host order/window/projection are part of the equivalent pipeline, not invisible work.',
        'reference',
        'clojure',
      ),
    },
  },
  {
    id: 'sum',
    title: 'Sum without deduplicating equal amounts',
    contract:
      'Sum amount from active rows. Distinct ids m1 and m2 each contribute 4; expected 10, not 6. Empty input → 0.',
    expected: 10,
    variants: {
      JavaScript: variant([
        ['source', 'const source = rows;'],
        ['filter', 'const active = source.filter(r => r.active);'],
        ['aggregate', 'return active.reduce((sum,r) => sum+r.amount,0);'],
      ]),
      jq: variant(
        [
          ['source', '.rows'],
          ['filter', '| map(select(.active))'],
          ['aggregate', '| (map(.amount) | add // 0)'],
        ],
        '',
        'reference',
        'jq',
      ),
      Lodash: variant([
        ['source', 'const source = rows;'],
        ['filter', 'const active = _.filter(source,{active:true});'],
        ['aggregate', "return _.sumBy(active,'amount');"],
      ]),
      Ramda: variant([
        ['source', 'return R.pipe('],
        ['filter', '  R.filter(R.propEq(true,"active")),'],
        ['aggregate', '  R.pluck("amount"), R.sum\n)(rows);'],
      ]),
      'Immutable.js': variant([
        ['source', 'const source = I.List(rows);'],
        ['filter', 'const active = source.filter(r => r.active);'],
        ['aggregate', 'return active.reduce((sum,r) => sum+r.amount,0);'],
      ]),
      'state view (proposal)': variant(
        [
          ['source', 'const source = view.from(rows);'],
          ['filter', 'const active = source.where({active:true});'],
          ['aggregate', "return active.sum('amount');"],
        ],
        'Full recompute reference implementation, not differential dataflow.',
      ),
      Datalog: variant(
        [
          ['source', '[:find (sum ?amount) . :with ?r :in $ :where'],
          ['filter', ' [?r :row/active true]'],
          ['aggregate', ' [?r :row/amount ?amount]]\n;; Host: normalize no-result to 0.'],
        ],
        ':with ?r retains row multiplicity when amounts are equal. A scalar query may have a different empty-result shape; normalize explicitly.',
        'reference',
        'clojure',
      ),
      Prisma: variant(
        [
          ['source', 'return prisma.row.aggregate({'],
          ['filter', '  where:{active:true},'],
          ['aggregate', '  _sum:{amount:true}\n}).then(x => x._sum.amount ?? 0);'],
        ],
        'SQL aggregate empty sum is typically null; normalize to the contract.',
        'reference',
        'ts',
      ),
      Drizzle: variant(
        [
          ['source', 'return db.select({total:sum(row.amount)}).from(row)'],
          ['filter', '  .where(eq(row.active,true))'],
          ['aggregate', '  .then(([x]) => Number(x.total ?? 0));'],
        ],
        'Driver may return SQL sum as string; numeric conversion is explicit and assumes this small integer fixture.',
        'reference',
        'ts',
      ),
      'TanStack DB': variant([
        ['source', 'const result = await db.queryOnce(q => q.from({r:collection})'],
        ['filter', '  .where(({r}) => db.eq(r.active,true))'],
        ['aggregate', '  .select(({r}) => ({total:db.sum(r.amount)})));\nreturn result[0]?.total ?? 0;'],
      ]),
    },
  },
  {
    id: 'join',
    title: 'Join owner records without inventing a missing user',
    contract:
      'Inner join all rows to users. Omit x1 whose owner is missing. Keep row position and project {id, owner}.',
    expected: [
      { id: 'g1', owner: 'Ada' },
      { id: 'm2', owner: 'Lin' },
      { id: 'm1', owner: 'Ada' },
    ],
    variants: {
      JavaScript: variant([
        ['source', 'const source = rows;'],
        ['join', 'const joined = source.flatMap(r => users.filter(u => u.id === r.ownerId).map(u => ({r,u})));'],
        ['project', 'return joined.map(({r,u}) => ({id:r.id,owner:u.name}));'],
      ]),
      jq: variant(
        [
          ['source', '.users as $users | .rows'],
          ['join', '| [.[] as $r | $users[] | select(.id == $r.ownerId)'],
          ['project', '  | {id:$r.id,owner:.name}]'],
        ],
        '',
        'reference',
        'jq',
      ),
      Lodash: variant([
        ['source', 'const source = rows;'],
        ['join', 'const joined = _.flatMap(source,r => _.filter(users,{id:r.ownerId}).map(u => ({r,u})));'],
        ['project', 'return joined.map(({r,u}) => ({id:r.id,owner:u.name}));'],
      ]),
      Ramda: variant([
        ['source', 'const source = rows;'],
        ['join', 'const joined = R.chain(r => R.filter(u => u.id === r.ownerId, users).map(u => ({r,u})),source);'],
        ['project', 'return R.map(({r,u}) => ({id:r.id,owner:u.name}),joined);'],
      ]),
      'Immutable.js': variant([
        ['source', 'const source = I.List(rows);'],
        [
          'join',
          'const joined = source.flatMap(r => I.List(users).filter(u => u.id === r.ownerId).map(u => ({r,u})));',
        ],
        ['project', 'return joined.map(({r,u}) => ({id:r.id,owner:u.name})).toArray();'],
      ]),
      Datalog: variant(
        [
          ['source', '[:find ?id ?name ?position :in $ :where'],
          ['join', ' [?r :row/owner ?u] [?u :user/name ?name]'],
          [
            'project',
            ' [?r :row/id ?id] [?r :row/position ?position]]\n;; Host: sort position; map to {id, owner:name}.',
          ],
        ],
        'Reference ingest uses entity references, not raw ownerId strings. Missing user is omitted by the join.',
        'reference',
        'clojure',
      ),
      'TanStack DB': variant([
        ['source', 'const result = await db.queryOnce(q => q.from({r:collection})'],
        ['join', "  .join({u:userCollection},({r,u}) => db.eq(r.ownerId,u.id),'inner')"],
        ['order', "  .orderBy(({r}) => r.position,'asc')"],
        [
          'project',
          '  .select(({r,u}) => ({id:r.id,owner:u.name})));\n// Strip TanStack virtual metadata explicitly to match the plain output contract.\nreturn result.map(({id,owner}) => ({id,owner}));',
        ],
      ]),
      Drizzle: variant(
        [
          ['source', 'return db.select({id:row.id,owner:user.name}).from(row)'],
          ['join', '  .innerJoin(user,eq(row.ownerId,user.id))'],
          ['order', '  .orderBy(asc(row.position));'],
        ],
        'Requires the explicitly declared row/user schema.',
        'reference',
        'ts',
      ),
      Prisma: variant(
        [
          ['source', 'return prisma.row.findMany({'],
          ['join', '  where:{owner:{isNot:null}}, include:{owner:true},'],
          ['order', "  orderBy:{position:'asc'}"],
          ['project', '}).then(xs => xs.map(r => ({id:r.id,owner:r.owner.name})));'],
        ],
        'Requires an optional owner relation in the Prisma model. Relation loading is not syntactically the same operation as a client array join.',
        'reference',
        'ts',
      ),
    },
  },
  {
    id: 'write',
    title: 'Immutable write — a different operation from querying',
    contract:
      'Set m1.active to false; keep input unchanged. Return plain rows to compare values, not container identity. Unchanged rows may be structurally shared.',
    expected: FIXTURE.rows.map((r) => (r.id === 'm1' ? { ...r, active: false } : r)),
    variants: {
      JavaScript: variant([
        ['source', 'const source = rows;'],
        ['write', "return source.map(r => r.id === 'm1' ? {...r,active:false} : r);"],
      ]),
      Immer: variant(
        [
          ['source', 'const source = rows;'],
          [
            'write',
            "return produce(source,draft => {\n  const row = draft.find(r => r.id === 'm1');\n  if (row) row.active = false;\n});",
          ],
        ],
        'Produce returns a new state while preserving unmodified structure; no query index is implied.',
      ),
      'Immutable.js': variant(
        [
          ['source', 'const source = I.fromJS(rows);'],
          ['write', "return source.map(r => r.get('id') === 'm1' ? r.set('active',false) : r).toJS();"],
        ],
        'Unlike the read examples, fromJS converts nested rows into Maps. Conversion cost is real and not hidden in performance claims.',
      ),
      Ramda: variant([
        ['source', 'const source = rows;'],
        ['write', 'return R.map(R.when(R.propEq("m1","id"), R.assoc("active",false)),source);'],
      ]),
      Lodash: variant(
        [
          ['source', 'const source = rows;'],
          ['write', "return _.map(source,r => r.id === 'm1' ? {...r,active:false} : r);"],
        ],
        '_.set would mutate its input; do not call it a drop-in immutable alternative without copying.',
      ),
      jq: variant(
        [
          ['source', '.rows'],
          ['write', '| map(if .id == "m1" then .active = false else . end)'],
        ],
        'JSON value transformation, not a subscription or persistent collection.',
        'reference',
        'jq',
      ),
    },
  },
];
export function fullSnippet(v: Variant): string {
  if (v.lang === 'jq' || v.lang === 'clojure') return v.code;
  const setup = `const {rows,users,excluded} = ${JSON.stringify(FIXTURE, null, 2)};`;
  const deps = [
    v.code.includes('_') ? "import _ from 'lodash';" : '',
    v.code.includes('R.') ? "import * as R from 'ramda';" : '',
    v.code.includes('I.') ? "import * as I from 'immutable';" : '',
    v.code.includes('produce(') ? "import {produce} from 'immer';" : '',
    v.code.includes('view.')
      ? "import {view} from './view-plan'; // site-local full-recompute research facade, not a published module"
      : '',
    v.code.includes('db.queryOnce')
      ? "import * as db from '@tanstack/db';\nconst collection = db.createCollection(db.localOnlyCollectionOptions({getKey:r=>r.id,initialData:rows}));\nconst userCollection = db.createCollection(db.localOnlyCollectionOptions({getKey:u=>u.id,initialData:users}));\ncollection.createIndex(r=>r.ownerId,{indexType:db.BasicIndex});\ncollection.createIndex(r=>r.rank,{indexType:db.BasicIndex});"
      : '',
  ].filter(Boolean);
  return `${setup}\n${deps.join('\n')}\n\nasync function example() {\n${v.code}\n}\nconsole.info(await example());`;
}
