import { href } from '../lib/router';
import { Code } from '../lib/Code';
import { T } from '../lib/T';
import { Fragment, useEffect, useState } from 'react';
import { LIBS, CATS, type Axis } from '../data/compare';
import { SPEC_VERSION } from '../data/facts';

const S = ['—', '◐', '●', '★'];
const SC = ['var(--grey)', 'var(--amber)', 'var(--accent)', 'var(--accent-ink)'];
const STATUS: Record<string, [string, string]> = {
  prototyped: ['done', 'prototyped'],
  designed: ['wip', `spec ${SPEC_VERSION}`],
  planned: ['todo', 'planned'],
};

export default function Compare() {
  const [sel, setSel] = useState<string[]>(LIBS.map((l) => l.id));
  const [active, setActive] = useState<Axis>(CATS[0].axes[0]);
  /** Below 980px the panel is a bottom sheet: it opens on a tap and closes on
   *  ✕. On a desktop it is the sticky aside and this flag does nothing. The
   *  alternative — the aside rendered after all six tables — put the row's
   *  detail 5,800px below the row on a phone, which is "unreachable" in every
   *  sense a reader cares about. */
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    addEventListener('keydown', close);
    return () => removeEventListener('keydown', close);
  }, []);
  const show = (a: Axis) => {
    setActive(a);
    if (matchMedia('(max-width: 1080px)').matches) setSheetOpen(true);
  };
  const toggle = (id: string) =>
    id !== 'state' && setSel((s) => (s.includes(id) ? (s.length > 2 ? s.filter((x) => x !== id) : s) : [...s, id]));
  return (
    <div className="wrap wide">
      <header className="page">
        <T as="p" className="kicker">
          {'state · compare (R27)'}
        </T>
        <h1>What you get that others don&rsquo;t</h1>
        <T as="p" className="lead">
          {`Grouped by what matters most, rated — ◐ ● ★ against each library. Hover any row: the panel on the right shows how state does it, a code sketch, and why it wins. Status tags keep the state column honest: prototyped (running on the Playground), spec ${SPEC_VERSION} (designed), planned. Every column header opens a head-to-head page for that library.`}
        </T>
      </header>
      <div className="chips" style={{ marginBottom: 14 }}>
        {LIBS.map((l) => (
          <button
            key={l.id}
            className={`chip${sel.includes(l.id) ? ' on' : ''}`}
            onClick={() => toggle(l.id)}
            title={l.note}
            disabled={l.id === 'state'}
          >
            {l.name}
          </button>
        ))}
      </div>
      <div className="cmp-layout">
        <div className="cmp-tables">
          {CATS.map((cat) => (
            <section className="layer" key={cat.name}>
              <div className="lhead">
                <h2>{cat.name}</h2>
              </div>
              <div className="tblwrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 220 }}>Feature</th>
                      {sel.map((id) => (
                        <th key={id}>
                          {id === 'state' ? (
                            LIBS.find((l) => l.id === id)!.name
                          ) : (
                            <a href={href(`/lib/${id}`)} title={`state vs ${LIBS.find((l) => l.id === id)!.name}`}>
                              {LIBS.find((l) => l.id === id)!.name}
                            </a>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cat.axes.map((a) => (
                      <tr
                        key={a.id}
                        id={`cmp-${a.id}`}
                        className={`cmp-row${active.id === a.id ? ' cmp-on' : ''}`}
                        onMouseEnter={() => show(a)}
                        onFocus={() => show(a)}
                        tabIndex={0}
                        aria-controls="comparison-detail"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            show(a);
                            setSheetOpen(true);
                          }
                        }}
                        onClick={() => {
                          setActive(a);
                          setSheetOpen(true);
                        }}
                      >
                        <td className="name" style={{ whiteSpace: 'normal' }}>
                          {a.axis} <span className={`status ${STATUS[a.status][0]}`}>{STATUS[a.status][1]}</span>
                        </td>
                        {sel.map((id) => {
                          const c = a.cells[id] || [0, ''];
                          return (
                            <td key={id} style={{ minWidth: 120 }}>
                              <span style={{ color: SC[c[0]], fontWeight: 700 }}>{S[c[0]]}</span>{' '}
                              <span className="lnote">{c[1]}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
        <aside
          id="comparison-detail"
          aria-label={`${active.axis} details`}
          className={`cmp-detail${sheetOpen ? ' open' : ''}`}
        >
          <div className="cmp-detail-in">
            <button className="sheet-close" onClick={() => setSheetOpen(false)} aria-label="close">
              ✕
            </button>
            <p className="kicker">{active.axis}</p>
            <h3>How state does it</h3>
            <T as="p">{active.ours}</T>
            {active.code && <Code>{active.code}</Code>}
            <h3>Why it wins</h3>
            <T as="p">{active.why}</T>
            <p className="lnote">
              <span className={`status ${STATUS[active.status][0]}`}>{STATUS[active.status][1]}</span>
              {active.demo && (
                <>
                  {' '}
                  · <a href={href(`/repl/${active.demo}`)}>see it live</a>
                </>
              )}
              {active.id === 'no-useeffect' && (
                <>
                  {' '}
                  · <a href={href('/effects')}>the full catalogue</a>
                </>
              )}
            </p>
          </div>
        </aside>
      </div>
      <section data-export-only>
        <h2>All feature explanations</h2>
        {CATS.flatMap((cat) => cat.axes).map((axis) => (
          <section key={axis.id}>
            <h3>{axis.axis}</h3>
            <p>Status: {axis.status}</p>
            <p>{axis.ours}</p>
            {axis.code && <pre>{axis.code}</pre>}
            <p>{axis.why}</p>
            {axis.demo && <a href={href(`/repl/${axis.demo}`)}>Executable example</a>}
          </section>
        ))}
      </section>
      <footer>
        Ratings condense the research reports behind the Landscape page; each library&rsquo;s cell names its actual
        mechanism so you can verify. Head-to-head pages:{' '}
        {LIBS.filter((l) => l.id !== 'state').map((l, i) => (
          <Fragment key={l.id}>
            {i > 0 && ' · '}
            <a href={href(`/lib/${l.id}`)}>{l.name}</a>
          </Fragment>
        ))}
        .
      </footer>
    </div>
  );
}
