import { useRef, useState } from 'react';
import {
  FIXTURE,
  QUERY_CASES,
  LANGUAGES,
  STAGES,
  fullSnippet,
  type Language,
  type Stage,
} from '../data/query-comparison';
import { snippetHref } from './snippet-transfer';
import { guideHref } from './learning';
import { Code } from './Code';

export function QueryWorkbench() {
  const [caseId, setCaseId] = useState('gap');
  const [left, setLeft] = useState<Language>('JavaScript');
  const [right, setRight] = useState<Language>('Datalog');
  const [stage, setStage] = useState<Stage>('filter');
  const [results, setResults] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const c = QUERY_CASES.find((c) => c.id === caseId)!;
  const choose = (id: string) => {
    ++generation.current;
    const next = QUERY_CASES.find((c) => c.id === id)!;
    const available = (Object.keys(STAGES) as Stage[]).filter((s) =>
      Object.values(next.variants).some((v) => v?.lines.some((line) => line.stage === s)),
    );
    setCaseId(id);
    setResults({});
    if (!available.includes(stage)) setStage(available[0] ?? 'source');
  };
  const run = async (language: Language) => {
    const v = c.variants[language];
    if (!v) return;
    const at = generation.current;
    setResults((r) => ({ ...r, [language]: 'Running the actual library…' }));
    try {
      const { runQueryFixture } = await import('./run-query-fixture');
      const result = await runQueryFixture(v);
      if (at !== generation.current) return;
      const equal = JSON.stringify(result) === JSON.stringify(c.expected);
      setResults((r) => ({
        ...r,
        [language]: `${equal ? 'PASS — same value and order' : 'FAIL — result differs'}\n${JSON.stringify(result, null, 2)}`,
      }));
    } catch (e) {
      if (at === generation.current) setResults((r) => ({ ...r, [language]: String(e) }));
    }
  };
  const pane = (language: Language, setLanguage: (l: Language) => void, side: string) => {
    const v = c.variants[language];
    return (
      <div className="query-pane">
        <label htmlFor={`query-${side}`}>{side === 'left' ? 'Left syntax' : 'Right syntax'} </label>
        <select id={`query-${side}`} value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
          {LANGUAGES.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        {v ? (
          <>
            <p className="api-badge">
              {v.status === 'executable' ? 'Executable fixture' : 'Reference — runtime not loaded'}
            </p>
            <div className="query-lines" aria-label={`${language} code`}>
              {v.lines.map((line, i) => (
                <span
                  className={`query-line${stage === line.stage ? ' is-paired' : ''}`}
                  key={i}
                  onMouseEnter={() => setStage(line.stage)}
                  onFocus={() => setStage(line.stage)}
                  tabIndex={0}
                  title={STAGES[line.stage]}
                  aria-describedby="query-hint"
                >
                  {line.text}
                </span>
              ))}
            </div>
            <p>{v.note}</p>
            <div className="snippet-controls">
              <a className="code-source" href={snippetHref(fullSnippet(v), v.lang, c.title)}>
                View exact source + setup
              </a>
              <a href={guideHref('queries')} title="Related complete query walkthrough in the state prototype">
                Try query example →
              </a>
              {v.status === 'executable' && <button onClick={() => run(language)}>Run fixture</button>}
            </div>
            {results[language] && (
              <pre className="pg-code" aria-live="polite" data-no-try>
                {results[language]}
              </pre>
            )}
          </>
        ) : (
          <p>
            This operation has no authored equivalent in this syntax yet. In particular, a write API is not presented as
            an equivalent read query. Choose another syntax; missing implementations are not emulated.
          </p>
        )}
      </div>
    );
  };
  return (
    <section>
      <h2>Compare the same task, not different programs</h2>
      <p>
        These are authored, normalized fixtures — not quotations from production repositories. Select any two spellings.
        The contract fixes input, identity, ordering, ties, missing relations and output shape before syntax is
        compared.
      </p>
      <div className="query-controls">
        <label htmlFor="query-case">Task </label>
        <select id="query-case" value={caseId} onChange={(e) => choose(e.target.value)}>
          {QUERY_CASES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>
      <p>
        <strong>Contract:</strong> {c.contract}
      </p>
      <details>
        <summary>Shared input fixture</summary>
        <Code lang="json">{JSON.stringify(FIXTURE, null, 2)}</Code>
      </details>
      <p>
        <strong>Expected output:</strong>
      </p>
      <Code lang="json">{JSON.stringify(c.expected, null, 2)}</Code>
      <div className="query-stages" aria-label="Corresponding constructs">
        {(Object.keys(STAGES) as Stage[])
          .filter((s) => [c.variants[left], c.variants[right]].some((v) => v?.lines.some((l) => l.stage === s)))
          .map((s) => (
            <button key={s} onClick={() => setStage(s)} aria-pressed={stage === s}>
              {s}
            </button>
          ))}
      </div>
      <div id="query-hint" className="query-hint" role="status">
        {STAGES[stage]}
      </div>
      <div className="query-panes">
        {pane(left, setLeft, 'left')}
        {pane(right, setRight, 'right')}
      </div>
      <p>
        No timing numbers are claimed. Value equivalence on this fixture does not establish equivalent reactivity,
        memory use, database collation, transaction semantics or performance.
      </p>
    </section>
  );
}
