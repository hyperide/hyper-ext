import { useEffect, useState } from 'react';
import { href } from '../lib/router';
import { T } from '../lib/T';
import { Code } from '../lib/Code';
import { EFFECTS, VERDICT_COUNT, VERDICT_LABEL, sampleFor, type EffectPattern, type Verdict } from '../data/effects';

/**
 * R84 — the fourteen reasons an effect gets written, and what replaces each.
 *
 * Its own page rather than a section of the CLI runbook: the lint rules are a
 * CLI feature, but "what replaces every effect you have ever written" is an
 * argument about the programming model, and a reader looking for it will not
 * think to open a page about a command-line tool.
 *
 * The layout is the Compare page's, for the same reason it works there: a table
 * you can scan down the left, and one panel on the right that follows the
 * pointer. Expanding rows made the reader lose their place on every click and
 * hid thirteen rows to show one.
 */
export default function Effects() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const show = (value: EffectPattern) => {
    setActive(value);
    if (matchMedia('(max-width:1080px)').matches) setSheetOpen(true);
  };
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    addEventListener('keydown', close);
    return () => removeEventListener('keydown', close);
  }, []);
  const [filter, setFilter] = useState<Verdict | 'all'>('all');
  const [active, setActive] = useState<EffectPattern>(EFFECTS[0]!);
  const rows = EFFECTS.filter((e) => filter === 'all' || e.verdict === filter);
  const before = sampleFor(active.n, 'before');
  const after = sampleFor(active.n, 'after');

  return (
    <div className="wrap">
      <header className="page">
        <T as="p" className="kicker">
          {'state · effects (R84)'}
        </T>
        <h1>
          No <code>{'useEffect'}</code> — and what replaces each one
        </h1>
        <T as="p" className="lead">
          {`A blanket ban is a rule people switch off, so there are two. no-effect-for-state is an error and fires when an effect's body both reads state and writes state, or reads state and writes the non-DOM outside world — network, storage, the URL, analytics. effect-must-be-dom is a warning that fires on every surviving effect, and a project ratchets it to an error per directory as it cleans up.`}
        </T>
        <T as="p">
          {`The line between them is scheduling, not taste. Declared reactions run post-commit, before React has rendered the state that triggered them, so an effect whose body needs the DOM to reflect the last render has nothing to attach to. The criterion is what the body needs, not what triggers it: scrolling a newly selected row into view is state-triggered and survives, because it measures a node that exists only after the render; a matchMedia subscription is DOM-triggered and does not, because its body only writes state.`}
        </T>
        <T as="p">
          {`Fourteen reasons an effect gets written, from a survey of real code: ${VERDICT_COUNT.codemod} are rewritten for you, ${VERDICT_COUNT.flag} are flagged for a human because the intent is not in the code, ${VERDICT_COUNT.split} depends on its body, and ${VERDICT_COUNT.keep} legitimately stay — which is why the escape hatch is a renamed import, useDomEffect(ref, fn, deps), rather than a suppression comment. The signature forces the ref, so the claim is partly checkable, and grep -c useDomEffect is a number CI can ratchet down.`}
        </T>
      </header>

      <div className="chips" style={{ marginBottom: 12 }}>
        {(['all', 'codemod', 'flag', 'split', 'keep'] as const).map((v) => (
          <button key={v} className={`chip${filter === v ? ' on' : ''}`} onClick={() => setFilter(v)}>
            {v === 'all' ? `all ${EFFECTS.length}` : `${VERDICT_LABEL[v][1]} · ${VERDICT_COUNT[v]}`}
          </button>
        ))}
      </div>

      <div className="cmp-layout">
        <div className="cmp-tables">
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th>
                  <th style={{ minWidth: 200 }}>Why the effect exists</th>
                  <th style={{ minWidth: 150 }}>What replaces it</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.n}
                    id={`eff-${e.n}`}
                    className={`cmp-row${active.n === e.n ? ' cmp-on' : ''}`}
                    tabIndex={0}
                    onFocus={() => show(e)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        show(e);
                      }
                    }}
                    onMouseEnter={() => show(e)}
                    onClick={() => show(e)}
                  >
                    <td className="lnote">{e.n}</td>
                    <td className="name" style={{ whiteSpace: 'normal' }}>
                      {e.reason}{' '}
                      <span className={`status ${VERDICT_LABEL[e.verdict][0]}`}>{VERDICT_LABEL[e.verdict][1]}</span>
                    </td>
                    <td className="lnote" style={{ whiteSpace: 'normal' }}>
                      {e.target}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className={`cmp-detail${sheetOpen ? ' open' : ''}`}>
          <div className="cmp-detail-in">
            <button className="sheet-close" aria-label="close" onClick={() => setSheetOpen(false)}>
              ✕
            </button>
            <p className="kicker">
              {active.n}. {active.reason}
            </p>
            <h3>Why it gets written, and what it becomes</h3>
            <T as="p">{active.note}</T>
            {before && (
              <>
                <h3>Before</h3>
                <Code>{before}</Code>
              </>
            )}
            {after && (
              <>
                <h3>After</h3>
                <Code>{after}</Code>
              </>
            )}
            <p className="lnote">
              <span className={`status ${VERDICT_LABEL[active.verdict][0]}`}>{VERDICT_LABEL[active.verdict][1]}</span> ·{' '}
              <a href={href('/cli')}>the lint that enforces it</a>
            </p>
          </div>
        </aside>
      </div>
      <footer>
        The full catalogue — the reasoning behind every verdict, and why the survivors must stay survivors rather than
        being absorbed by the store — is the research document behind R84. These are its conclusions.
      </footer>
    </div>
  );
}
