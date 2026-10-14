import { useState } from 'react';
import { Code } from '../lib/Code';
import { Toc, useHeadings } from '../lib/Toc';
import { href } from '../lib/router';
import { cases, invoices, customers, runCase } from '../../../experiments/2026-09-08/corpus.mjs';
import * as corpusSourceModule from '../../../experiments/2026-09-08/corpus.mjs?raw';
const corpusSource = corpusSourceModule.default;
import { exampleSource } from '../../../experiments/2026-09-08/example-source.mjs';
const printed = Object.fromEntries(cases.map((c) => [c.id, exampleSource(corpusSource, c.id)]));
export default function OperatorCorpus() {
  const [results, setResults] = useState<Record<string, string>>({});
  const headings = useHeadings('.operator-body', []);
  const run = (id: string) => {
    try {
      setResults((r) => ({ ...r, [id]: JSON.stringify(runCase(id), null, 2) }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: String(e) }));
    }
  };
  return (
    <div className="wrap wide withtoc">
      <style>{`.operator-body,.operator-card,.operator-pair>div{min-width:0}.operator-card{margin:20px 0;padding:18px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.operator-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.operator-card pre{max-width:100%;max-height:420px;overflow:auto}.operator-pair>div:hover{outline:1px solid var(--line)}@media(max-width:760px){.operator-pair{grid-template-columns:minmax(0,1fr)}}`}</style>
      <header className="page">
        <p className="kicker">state · executable comparisons</p>
        <h1>Query operators, one task at a time</h1>
        <p className="lead">
          {cases.length} runnable pairs. One shared fixture, a native JavaScript reference and the experimental operator
          algebra. No jq, Datalog or third-party adapter is presented as executed.
        </p>
        <p>
          <a href={`${href('/spec')}#operator-algebra`}>Semantics and optimization plans</a> ·{' '}
          <a href={href('/selectors-vs-datalog')}>Existing production-selector research</a> ·{' '}
          <a href={href('/api')}>Prototype API</a>
        </p>
      </header>
      <div className="tocwrap">
        <main className="operator-body">
          <h2>Shared input and setup</h2>
          <p>
            All amounts are integer cents in one currency. IDs are identities, not positions. Import q, pick, omit,
            quantile, variance, histogram, pivot and zip from experiments/2026-09-08/operators.mjs. amounts means
            invoices.map(r =&gt; r.amount); ids means invoices.map(r =&gt; r.id). The native quantile helper implements
            the same type-7 interpolation shown below.
          </p>
          <details>
            <summary>Show the complete fixture and reference helper</summary>
            <Code lang="js">{`const invoices = ${JSON.stringify(invoices, null, 2)};\nconst customers = ${JSON.stringify(customers, null, 2)};\nconst amounts = invoices.map(r => r.amount);\nconst ids = invoices.map(r => r.id);\nconst nativeQuantile = (a,p) => { a=[...a].sort((x,y)=>x-y); if(!a.length)return null; const i=(a.length-1)*p,k=Math.floor(i); return a[k]*(1-(i-k))+a[Math.ceil(i)]*(i-k); };`}</Code>
          </details>
          <p>
            Run both invokes the exact functions displayed. Integer/order/shape results must match; floating-point
            values use relative tolerance 1e-10. This is a correctness corpus, not a library-speed leaderboard. Editing
            and additional-language adapters belong to the existing REPL integration and are not implemented on this
            page yet.
          </p>
          {Array.from(new Set(cases.map((c) => c.family))).map((family) => (
            <section key={family}>
              <h2>{family}</h2>
              {cases
                .filter((c) => c.family === family)
                .map((c) => (
                  <article className="operator-card" key={c.id} id={`operator-${c.id}`}>
                    <h3>{c.title}</h3>
                    <div className="operator-pair">
                      <div>
                        <h4>Native JavaScript reference</h4>
                        <Code lang="js">{printed[c.id].native}</Code>
                      </div>
                      <div>
                        <h4>Experimental operator form</h4>
                        <Code lang="js">{printed[c.id].code}</Code>
                      </div>
                    </div>
                    <p>{c.note}</p>
                    <button type="button" onClick={() => run(c.id)} aria-controls={`result-${c.id}`}>
                      Run both · verify result
                    </button>
                    <div id={`result-${c.id}`} aria-live="polite">
                      {results[c.id] && <pre>{results[c.id]}</pre>}
                    </div>
                  </article>
                ))}
            </section>
          ))}
        </main>
        <Toc headings={headings} />
      </div>
    </div>
  );
}
