import { useMemo, useState } from 'react';
import { Toc, useHeadings } from '../lib/Toc';
import { V, LAYERS, ROWS, WHY, V2, type Row } from '../data/landscape';
import { INSIGHTS } from '../data/insights';
import { linkifyCell } from '../lib/linkify';
import { href } from '../lib/router';
import { LANDSCAPE_NAME } from './Library';

/** Reverse of Library.tsx's compare-id → landscape-name map, so a row whose name matches a
 *  compared library can link straight to its head-to-head /lib/<id> page. */
const LIB_ID_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(LANDSCAPE_NAME).map(([id, name]) => [name, id]),
);
const COLORS: Record<string, string> = {
  core: 'var(--accent)',
  protocol: 'var(--blue)',
  steal: 'var(--accent)',
  interop: 'var(--blue)',
  watch: 'var(--amber)',
  avoid: 'var(--red)',
  superseded: 'var(--grey)',
};
function RowTr({ r }: { r: Row }) {
  const [, name, pkg, ver, size, lic, traits, take, verdict, note] = r;
  const extra = V2[name];
  const libId = LIB_ID_BY_NAME[name];
  return (
    <tr>
      <td className="name">
        {libId ? <a href={href(`/lib/${libId}`)}>{name}</a> : name}
        <small>{pkg}</small>
      </td>
      <td className="num">{ver}</td>
      <td className="num">{size}</td>
      <td className="num">{lic}</td>
      <td className="traits" dangerouslySetInnerHTML={{ __html: linkifyCell(traits) }} />
      <td className="take" dangerouslySetInnerHTML={{ __html: linkifyCell(take) }} />
      <td className="why" dangerouslySetInnerHTML={{ __html: linkifyCell(WHY[name] || '') }} />
      <td className="verdict">
        <span className={`v ${verdict}`}>{V[verdict]}</span>
        {extra && (
          <>
            {' '}
            <span className={`v ${extra[0]}`}>{V[extra[0]]}</span>
          </>
        )}
        <small>
          {note}
          {extra ? ` · ${extra[1]}` : ''}
        </small>
      </td>
    </tr>
  );
}
export default function Landscape() {
  const headings = useHeadings('.landscape-body', []);
  const [layer, setLayer] = useState('all');
  const [term, setTerm] = useState('');
  const [verdicts, setVerdicts] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setVerdicts((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const q = term.trim().toLowerCase();
  const sections = useMemo(() => {
    const match = (r: Row) =>
      (!verdicts.size || verdicts.has(r[8]) || (V2[r[1]] && verdicts.has(V2[r[1]][0]))) &&
      (!q || `${r[1]} ${r[2]} ${r[6]} ${r[7]} ${r[9]} ${WHY[r[1]] || ''}`.toLowerCase().includes(q));
    return LAYERS.filter((L) => layer === 'all' || layer === L.id)
      .map((L) => ({ L, rows: ROWS.filter((r) => r[0] === L.id && match(r)) }))
      .filter((s) => s.rows.length);
  }, [layer, q, verdicts]);
  return (
    <div className="wrap wide withtoc">
      <header className="page">
        <p className="kicker">state · landscape research</p>
        <h1>The State of State</h1>
        <p className="lead">
          {ROWS.length} libraries and systems across six layers, surveyed and version-checked 2026-09-01/02. Verdicts
          say what the <code>state</code> toolkit does with each. Sizes are min+gzip, whole package.
        </p>
      </header>
      <div className="tocwrap">
        <div className="landscape-body">
          <div className="toolbar">
            <div className="toolrow">
              <div className="tabs">
                <button className={`tab${layer === 'all' ? ' on' : ''}`} onClick={() => setLayer('all')}>
                  All <span className="n">{ROWS.length}</span>
                </button>
                {LAYERS.map((L) => (
                  <button key={L.id} className={`tab${layer === L.id ? ' on' : ''}`} onClick={() => setLayer(L.id)}>
                    {L.title} <span className="n">{ROWS.filter((r) => r[0] === L.id).length}</span>
                  </button>
                ))}
              </div>
              <input
                id="q"
                type="search"
                placeholder="Filter libraries…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </div>
            <div className="chips">
              {Object.entries(V).map(([k, label]) => (
                <button key={k} className={`chip${verdicts.has(k) ? ' on' : ''}`} onClick={() => toggle(k)}>
                  <span className="dot" style={{ background: COLORS[k] }} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          {sections.map(({ L, rows }) => (
            <section className="layer" key={L.id}>
              <div className="lhead">
                <h2>{L.title}</h2>
                <span className="spec" dangerouslySetInnerHTML={{ __html: linkifyCell(`spec ${L.spec}`) }} />
                <span className="lnote">{L.note}</span>
              </div>
              {INSIGHTS[L.id] && (
                <details className="insights">
                  <summary>Layer insights — what the survey concluded here</summary>
                  <ul>
                    {INSIGHTS[L.id].map((t, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: linkifyCell(t) }} />
                    ))}
                  </ul>
                </details>
              )}
              <div className="tblwrap">
                <table>
                  <thead>
                    <tr>
                      <th>Library</th>
                      <th>Version</th>
                      <th>Size</th>
                      <th>Licence</th>
                      <th>What it is</th>
                      <th>What we take</th>
                      <th>Why</th>
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <RowTr key={r[1]} r={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {!sections.length && (
            <div className="empty" style={{ display: 'block' }}>
              Nothing matches — clear the search or verdict filters.
            </div>
          )}
        </div>
        <Toc headings={headings} />
      </div>
      <footer>
        Data lives in <code>src/data/landscape.ts</code> — the single source for this page and the shared artifact
        mirror.
      </footer>
    </div>
  );
}
