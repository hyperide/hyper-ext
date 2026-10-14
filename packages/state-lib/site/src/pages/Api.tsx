import { useMemo, useState } from 'react';
import { GENERATED_API } from '../lib/api-docs.generated';
import { referenceDoc } from '../lib/api-reference-prose';
import { EXAMPLES } from '../data/examples';
import { Code } from '../lib/Code';
import { href } from '../lib/router';

const GROUPS = [
  {
    id: 'reactivity',
    title: 'Signals and derived values',
    section: 's4-1',
    about:
      'Read a signal inside derive/watch to track it. Prefer derive for computed state; watch is a low-level subscription, not the proposed post-commit effect API.',
  },
  {
    id: 'store',
    title: 'Store, commands, history and collections',
    section: 's4-4',
    about:
      'Use createStore for named mutable-looking actions that produce snapshots and patches. Undo/redo operate on command history; they are not network transaction rollback.',
  },
  {
    id: 'tasks',
    title: 'Tasks, cancellation and ownership',
    section: 's4-15',
    about:
      'Use a Scope when work belongs to a route or screen. Run and spawn keep ownership explicit. Cancellation status and complete settlement differ when a child is shielded.',
  },
  {
    id: 'boundaries',
    title: 'Parsing, presentation and persistence',
    section: 's4-13-5',
    about:
      'Use codec conversions at the wire boundary and partial parsers at the input boundary. A partially typed value must not overwrite a valid domain value.',
  },
  {
    id: 'types',
    title: 'Types, policies and remaining exports',
    section: 's17',
    about:
      'The complete generated export/member index. Type declarations and data properties are reference material, not executable statements.',
  },
];
function group(name: string) {
  if (/^(store\.|createStore|deriveCollection|Collection|Patch|Command|Optimistic|History)/.test(name)) return 'store';
  if (/^(Task|Scope|Cancel|createScope|delay|Supersession|RunOptions)/.test(name)) return 'tasks';
  if (
    /^(Field|Presented|CustomType|Codec|Parse|Present|field|presented|customType|DateType|storageAdapter|memoryStorage|Persistence)/.test(
      name,
    )
  )
    return 'boundaries';
  if (/^(signal|derive|watch|tx|Signal|Derived|Watch|Computed|Disposer)/.test(name)) return 'reactivity';
  return 'types';
}
const anchor = (name: string) => `api-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const PLANNED = [
  [
    'defineStore / slice / defineComplex',
    'Composition and schema-typed regions; prototype createStore is not their production implementation.',
    's4-2',
  ],
  [
    'fsm({ states, on })',
    'A constrained slice whose transitions use the ordinary command/patch pipeline. Guards, invalid transitions and migration are explained with a plain-slice alternative.',
    's4-6',
  ],
  [
    'effect({ on, writes, run })',
    'Declared post-commit reaction, distinct from the working low-level watch(fn).',
    's4-14',
  ],
  [
    'query / IVM adapter',
    'Typed relational operations and result deltas, with explicit fallback for arbitrary JS. Engine integration remains a design contract.',
    's8-10',
  ],
  [
    'useSlice / useTracked / useActions / For',
    'Proposed React-facing adapter APIs, not React exports. The prototype REPL bindings do not prove production compiler integration.',
    's6-1',
  ],
  [
    'Vue / Solid / Svelte / Angular / Lit adapters',
    'Framework-specific bridges; native and state-owned names are separated in the adapter guide.',
    's6',
  ],
  [
    'state migrate / state lint / statec',
    'CLI/compiler designs rather than callable exports of the current browser prototype.',
    's11',
  ],
];
const all = Object.entries(GENERATED_API);
export default function Api() {
  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () =>
      all.filter(([name, entry]) => `${name} ${entry.doc} ${entry.sig}`.toLowerCase().includes(search.toLowerCase())),
    [search],
  );
  return (
    <div className="wrap wide">
      <header className="page">
        <p className="kicker">state · API reference</p>
        <h1>API: what exists, and what is designed</h1>
        <p className="lead">
          Every exported prototype symbol and generated member is indexed below with its full TypeScript signature.
          Planned production APIs have a separate section: a signature sketch is not an implementation.
        </p>
      </header>
      <label htmlFor="api-search">Find a method, type or parameter</label>
      <br />
      <input
        id="api-search"
        className="api-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="signal, undo, TaskContext, parse…"
      />
      <p role="status">
        {filtered.length} of {all.length} generated entries
      </p>
      <nav className="api-index" aria-label="API groups">
        {GROUPS.map((g) => (
          <a key={g.id} href={href('/api', g.id)}>
            {g.title}
          </a>
        ))}
        <a href={href('/api', 'planned')}>Planned API</a>
      </nav>
      {GROUPS.map((g) => {
        const entries = filtered.filter(([name]) => group(name) === g.id);
        if (!entries.length) return null;
        return (
          <section key={g.id} id={g.id} className="api-group">
            <h2>{g.title}</h2>
            <p>
              {g.about} <a href={href('/spec', g.section)}>Contract and alternatives →</a>
            </p>
            {entries.map(([name, entry]) => {
              const short = name.split('.').pop()!;
              const prose = referenceDoc(name);
              const example = EXAMPLES.find((e) =>
                new RegExp(`\\b${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(e.code),
              );
              return (
                <article className="api-entry" id={anchor(name)} key={name}>
                  <h3>
                    <a href={href('/api', anchor(name))}>{name}</a>
                  </h3>
                  <span className="api-badge">prototype · {entry.kind}</span>
                  <p>
                    {prose ||
                      'This member has no dedicated prose comment yet. Its exact contract is the generated signature below; consult its containing type and linked spec before use.'}
                  </p>
                  <Code lang="typescript-signature">{entry.sig}</Code>
                  {example && (
                    <details>
                      <summary>Usage in a complete example: {example.title}</summary>
                      <p>{example.about}</p>
                      <a href={href(`/repl/${example.id}`)}>Run this complete example →</a>
                      <Code>{example.code}</Code>
                    </details>
                  )}
                </article>
              );
            })}
          </section>
        );
      })}
      <section id="planned" className="api-group">
        <h2>Planned production API — not prototype exports</h2>
        {PLANNED.map(([name, about, section]) => (
          <article className="api-entry" key={name}>
            <h3>{name}</h3>
            <span className="api-badge">specification</span>
            <p>
              {about} <a href={href('/spec', section)}>Detailed contract →</a>
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
