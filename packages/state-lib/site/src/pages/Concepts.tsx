import { T } from '../lib/T';
import { exampleById } from '../data/examples';
import { Code } from '../lib/Code';
import { href, rewriteRouteLinks } from '../lib/router';
import { Toc, useHeadings } from '../lib/Toc';
import React from 'react';
import fragment from '../content/concepts-fragment.html?raw';
import { linkify } from '../lib/linkify';
import { highlightHtml } from '../lib/highlight';
import { GLOSSARY } from '../data/glossary';
import PushPullDemo from './PushPullDemo';
export default function Concepts() {
  const headings = useHeadings('.concepts-body', []);
  return (
    <div className="wrap withtoc">
      <header className="page">
        <p className="kicker">state · concepts</p>
        <h1>Concept explainers</h1>
        <p className="lead">
          The concepts the spec and the landscape build on — for each: what it is, why it matters for the toolkit, and a
          picture. Illustrations share one visual language; interactive and animated versions are being added, starting
          with push-pull below.
        </p>
      </header>
      <div className="tocwrap">
        <div className="concepts-body">
          <p>
            <a href={href('/concepts/practical')}>
              Practical examples: slice, FSM, DAG, ALS, transactions, microtasks, double buffering and input editing →
            </a>
          </p>
          <p>
            <a href={href('/adapters')}>Framework adapters: native imports versus state-owned APIs →</a>
          </p>
          <section className="concept" id="push-pull-interactive">
            <h2>Push-pull, step by step</h2>
            <p className="lead">
              Walk the algorithm yourself: write a signal, then flush, and watch which nodes actually recompute.
            </p>
            <PushPullDemo />
            <p>
              The visible subscriber is what triggers a pull; an unobserved derive stays lazy. A source notification and
              React’s eventual DOM commit are different scheduling boundaries.{' '}
              <a href={href('/learning')}>Detailed explanation, consistency examples and prior art →</a>
            </p>
            <Code repl="lazy-ui">{exampleById('lazy-ui')!.code}</Code>
            <h3>Two writes, one intent</h3>
            <p>
              Without a batch, changing quantity and then price can notify a subscriber of the intermediate total. A
              batch defers observers; it does not hide explicit reads inside its body or provide rollback.
            </p>
            <Code repl="writes-batched">{exampleById('writes-batched')!.code}</Code>
          </section>
          <div
            dangerouslySetInnerHTML={{
              __html: React.useMemo(() => rewriteRouteLinks(linkify(highlightHtml(fragment))), []),
            }}
          />
          <section className="concept" id="sync-labs">
            <h2>Electric: try the protocol problems</h2>
            <p>
              Small shared boards also need synchronisation. SSE is a transport; Electric already supports it. What must
              still be specified is snapshot/delta continuity, membership, deletes, checkpoints and refetch.{' '}
              <a href={href('/learning')}>Read scenarios, trade-offs, CDN/privacy boundaries and sources →</a>
            </p>
            <Code repl="sync-resume">{exampleById('sync-resume')!.code}</Code>
            <p>
              <a href={href('/repl/sync-large')}>Chunked snapshot</a> ·{' '}
              <a href={href('/repl/sync-reset')}>Expired history</a> ·{' '}
              <a href={href('/repl/electric-http')}>Actual HTTP reader: bring an authorised endpoint</a>
            </p>
          </section>
          <section className="concept" id="queries">
            <h2>Queries instead of selector pyramids</h2>
            <T as="p" className="lead">
              {
                'The hardest-to-maintain code in Redux-era apps is the derived-data layer: chains of hand-memoized selectors, each depending on the last, each needing its own tests and its own equality reasoning. A query engine can make relational intent explicit; incremental maintenance depends on the chosen engine and operators. Ordering, positional work and rendering still need explicit contracts.'
              }
            </T>
            <Code>{`// The selector pyramid (real-world shape):
const selectVisible = createSelector(selectTodos, selectFilter,
  (todos, f) => todos.filter(t => f === 'all' || t.status === f))
const selectSorted = createSelector(selectVisible, selectSortKey,
  (v, k) => [...v].sort(byKey(k)))               // re-sorts everything on any change
const selectGrouped = createSelector(selectSorted, selectUsers,
  (s, users) => groupBy(s, t => users[t.assignee]?.team))  // and re-groups

// DESIGN SKETCH, not Datomic syntax or a shipped API. The query (Datalog-style, planned engine — R32/R66):
const grouped = query\`
  [:find ?team (todos ?t)
   :where [?t :status \${filter}]
          [?t :assignee ?u] [?u :team ?team]
   :order \${sortKey}]\`
// declared once · incrementally maintained (consumes diffs)
// · planned by the engine · no memoization to get wrong`}</Code>
            <T as="p">
              {
                'The planned query layer is a Datalog-family engine (Datomic lineage, Rust compiled to wasm, running in the worker host) over collections; incrementally-maintained derive.collection views are the pure-JS stopgap with the same mental model. The first measurement exists: for one filter-sort-group over 10 000 rows, recomputing on every change costs 110 ms per 200 single-item updates against 1.8 ms maintained by derive.collection — about 61x, and that is the real primitive paying the full store path, not a hand-tuned special case. Read it as a direction rather than a product number: one query shape, one machine, a prototype, and it measures our own incremental primitive rather than a Datalog engine, which adds query planning on top (R66, §8.10).'
              }
            </T>
            <p className="lnote">
              The mature form of the language:{' '}
              <a href="https://docs.datomic.com/query/query-data-reference.html" target="_blank" rel="noreferrer">
                Datomic query data reference
              </a>
              .
            </p>
            <div className="why-us">
              <b>Why it matters:</b>{' '}
              <T>
                {
                  'selectors are hand-written query plans with hand-written caching. A query engine makes both someone else\u2019s job — and history-aware queries ("as of transaction N") come with it, Datomic-style.'
                }
              </T>{' '}
              — <a href={href('/repl/queries')}>see it live</a>.
            </div>
          </section>

          <section className="concept" id="glossary">
            <h2>Glossary (R63)</h2>
            <p className="lead">Every term below becomes a hover tooltip wherever it appears across the docs.</p>
            <dl className="gloss">
              {Object.entries(GLOSSARY).map(([term, g]) => (
                <div key={term} id={`g-${term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                  <dt>{term}</dt>
                  <dd>
                    {g.def}
                    {g.compare && <em> {g.compare}</em>}
                    {g.link &&
                      g.link !== '/concepts' && (
                        // The deeper pointer lives here, in the definition, rather than
                        // on the inline term — an inline term must land on a definition.
                        <>
                          {' '}
                          <a href={href(g.link)}>read more →</a>
                        </>
                      )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <footer>state · concepts v1</footer>
        </div>
        <Toc headings={headings} />
      </div>
    </div>
  );
}
