import { useMemo } from 'react';
import { marked } from 'marked';
import { QueryWorkbench } from '../lib/QueryWorkbench';
import { MappedPair } from '../lib/MappedPair';
import corpusRecords from '../content/selector-corpus-records.md?raw';
import fullCorpus from '../../../docs/research/2026-09-04-selector-corpus-and-datalog-mapping.md?raw';
import { highlightHtml } from '../lib/highlight';
import { rewriteRouteLinks, href } from '../lib/router';
import { Toc, useHeadings } from '../lib/Toc';
import { T } from '../lib/T';
import { selectorCorpus, PRIMARY_SHAPE, STAGE_FREQUENCY, FINDINGS, type Maps } from '../data/selector-datalog-corpus';

const MAPS_CLASS: Record<Maps, string> = {
  cleanly: 'svd-maps-yes',
  partially: 'svd-maps-partial',
  'not-at-all': 'svd-maps-no',
};

/** R66/R32 — the reselect/Redux-Toolkit selector research, made into an actual page: the
 *  22-chain corpus was already fully researched (see RESEARCH_DOC) and cited once, in a
 *  paragraph of the master spec. This is the "collect it on the site, with real Datalog
 *  examples for the typical and interesting cases" version. */
export default function SelectorsVsDatalog() {
  const headings = useHeadings('.svd-body', []);
  const records = useMemo(
    () =>
      rewriteRouteLinks(
        (marked.parse(corpusRecords) as string)
          .replace(/<table>/g, '<div class="tblwrap"><table>')
          .replace(/<\/table>/g, '</table></div>'),
      ),
    [],
  );
  const method = useMemo(
    () =>
      rewriteRouteLinks(
        highlightHtml(marked.parse(fullCorpus) as string)
          .replace(/<table>/g, '<div class="tblwrap"><table>')
          .replace(/<\/table>/g, '</table></div>'),
      ),
    [],
  );
  return (
    <div className="wrap wide withtoc">
      {/* Page-scoped styles only — nothing here is a global class name, so it cannot
          collide with state.css. `.tblwrap`/`table`/`.wrap`/`.page`/`.kicker`/`.lead`
          below are this site's own existing generic classes, reused as-is. */}
      <style>{`
        .svd-cases { display: flex; flex-direction: column; gap: 20px; margin: 20px 0 32px; }
        .svd-card { border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; background: var(--panel); }
        .svd-card-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; margin-bottom: 4px; }
        .svd-card-head h3 { margin: 0; font-size: 16px; }
        .svd-repo { font: 600 12px 'IBM Plex Mono', monospace; color: var(--accent-ink); }
        .svd-shape { font-size: 12px; color: var(--muted); }
        .svd-what { margin: 4px 0 12px; color: var(--muted); }
        .svd-badge { display: inline-block; font: 600 11px 'IBM Plex Sans', sans-serif; padding: 2px 8px; border-radius: 999px; }
        .svd-maps-yes { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent-ink); }
        .svd-maps-partial { background: color-mix(in srgb, var(--amber, orange) 20%, transparent); color: var(--ink); }
        .svd-maps-no { background: color-mix(in srgb, var(--red, crimson) 16%, transparent); color: var(--ink); }
        .svd-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 10px 0; }
        @media (max-width: 720px) { .svd-pair { grid-template-columns: 1fr; } }
        .svd-pair-label { font: 600 11px 'IBM Plex Mono', monospace; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
        .svd-nodatalog { padding: 12px; border: 1px dashed var(--line); border-radius: 8px; color: var(--muted); font-size: 13px; }
        .svd-note { margin-top: 10px; font-size: 13.5px; color: var(--muted); }
        .svd-source { margin-top: 10px; font-size: 12px; }
        .svd-designed { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
        .svd-findings { padding-left: 20px; }
        .svd-findings li { margin: 10px 0; }
      `}</style>
      <header className="page">
        <p className="kicker">state · research made into a page</p>
        <h1>Compare query syntax, semantics and execution</h1>
        <p className="lead">
          Start with equivalent normalized tasks, then inspect all 22 records in the earlier production corpus. Syntax,
          immutable writes and incremental execution are separate questions. Missing runtimes and non-equivalent source
          excerpts are marked explicitly.
        </p>
      </header>
      <div className="tocwrap">
        <div className="svd-body">
          <QueryWorkbench />
          <p>
            <a href={href('/query-research')}>
              TanStack DB, differential dataflow, the intended Rust/WASM engine and the syntax proposal →
            </a>
          </p>
          <section id="production-corpus" className="corpus-records">
            <h2>All 22 production records and provenance</h2>
            <p>
              Every record is shown below. The earlier study captured source excerpts for 12 representative shapes; the
              other records retain their exact source links rather than invented quotations. The full method and source
              analysis follow on this same page.
            </p>
            <div className="md" dangerouslySetInnerHTML={{ __html: records }} />
          </section>
          <section>
            <h2>What the corpus shows</h2>
            <ol className="svd-findings">
              {FINDINGS.map((f, i) => (
                <li key={i}>
                  <T>{f}</T>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2>Primary shape</h2>
            <p className="svd-note">
              One shape per chain — which undercounts sorting badly, since sorting is almost never the whole of a
              selector but is very often the last thing it does. See stage frequency below for the corrective count.
            </p>
            <div className="tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Shape</th>
                    <th>Count</th>
                    <th>Chains</th>
                  </tr>
                </thead>
                <tbody>
                  {PRIMARY_SHAPE.map((r) => (
                    <tr key={r.shape}>
                      <td>{r.shape}</td>
                      <td className="num">{r.count}</td>
                      <td>{r.entries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2>Stage frequency</h2>
            <p className="svd-note">
              How many of the 22 chains contain each stage anywhere in them — a chain usually contributes to several
              rows.
            </p>
            <div className="tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Chains</th>
                    <th>Maps to Datalog?</th>
                  </tr>
                </thead>
                <tbody>
                  {STAGE_FREQUENCY.map((r) => (
                    <tr key={r.stage}>
                      <td>{r.stage}</td>
                      <td className="num">{r.chains}</td>
                      <td>{r.mapsToDatalog}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2>Source excerpts: mappings and the differences that remain</h2>
            <p className="svd-note">
              These 12 excerpts identify the original production shapes. They are NOT asserted to be complete equivalent
              programs. The research document quotes the real selector code and (where one exists) the Datalog form —
              never a paraphrase standing in for either. Every snippet is a short quotation, attributed, for
              identification and criticism; copyright stays with the source repository named on its card.
            </p>
            <div className="svd-cases">
              {selectorCorpus.map((c) => (
                <article className="svd-card" key={c.id} id={`svd-${c.id}`}>
                  <div className="svd-card-head">
                    <h3>{c.what}</h3>
                    <span className={`svd-badge ${MAPS_CLASS[c.maps]}`}>{c.mapsLabel}</span>
                  </div>
                  <div className="svd-shape">
                    {c.shape} · <span className="svd-repo">{c.repo}</span> · {c.licence}
                  </div>
                  <MappedPair item={c} />
                  <p className="svd-note">{c.note}</p>
                  <p className="svd-source">
                    <a href={c.sourceUrl} target="_blank" rel="noreferrer noopener">
                      Source, at the pinned commit →
                    </a>
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section>
            <h2>What this does not argue</h2>
            <p>
              <T>
                An unordered core Datalog result is not a complete ordered UI pipeline. Explicit position/path
                attributes, host stages and dialect extensions can recover particular cases, but the extra model and
                work must be visible. A source fragment, a remapped schema and a proposed query are not a proof of
                equivalent behavior. The normalized executable fixtures above are a separate, testable comparison; they
                do not establish a performance winner.
              </T>
            </p>
            <p className="svd-note">
              Also still open, per the research document: whether the Redux slices in this corpus are Datalog-shaped at
              all without re-modelling; what the query planner itself will cost, once one exists; and whether a
              22-chain, 7-repository sample — chosen for being hard, four of the seven chat clients — generalises to a
              dashboard- or commerce-heavy codebase.
            </p>
          </section>
          <section className="research-corpus" id="full-method">
            <h2>Full method, every case and original analysis</h2>
            <p>
              The complete source document is rendered here, not hidden behind a repository path. Read its correction
              notice before relying on earlier conclusions.
            </p>
            <div className="md" dangerouslySetInnerHTML={{ __html: method }} />
          </section>
        </div>
        <Toc headings={headings} />
      </div>
      <footer>
        All 22 records, the full method and the historical analysis are included above.{' '}
        <a href={href('/query-research')}>Read the updated conclusions →</a>
      </footer>
    </div>
  );
}
