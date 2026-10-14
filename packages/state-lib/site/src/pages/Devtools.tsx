import { T } from '../lib/T';
import { href } from '../lib/router';
import React from 'react';

/** R39 — devtools comparison on the axes that made Redux DevTools freeze. */
const ROWS: [string, string, string, string, string, string][] = [
  // tool, model, time travel, perf on big state, name fidelity, notes
  [
    'Redux DevTools',
    'full-state serialisation per action, cross-process',
    'yes (state replay)',
    'freezes: #282, #619, zustand #926; mitigations lossy (maxAge, sanitizers)',
    'action names only',
    'ubiquitous; our bridge keeps it with safe defaults',
  ],
  [
    'jotai-devtools 0.14',
    'in-app atom viewer',
    'snapshots with snapshotHistoryLimit (~30)',
    'good (bounded history)',
    'babel plugin injects debug labels',
    'best current in-app React panel',
  ],
  [
    'Stately Inspector',
    'typed inspection events stream',
    'event-log replay',
    'good (filter/serialize options)',
    'typed event names',
    'sequence diagrams — the visualisation bar',
  ],
  [
    'Reatom logger/devtools',
    'per-tx logs with cause chains',
    'partial',
    'good',
    'atom names via ctx',
    'cause chains = the debugging idea we adopted (§4.4)',
  ],
  [
    'MobX devtools',
    'stale standalone (2020); spy API',
    'no',
    '—',
    'decorated names',
    'mobx-devtools-mst still updates',
  ],
  [
    'Vue devtools (Pinia)',
    'timeline + store inspector',
    'yes',
    'froze on deep-serialising raw objects (#721); fixed by on-demand expansion',
    'store/getter names',
    'on-demand expansion = the right pattern',
  ],
  [
    'React DevTools (hooks)',
    'fiber inspection',
    'no',
    'ok',
    'hook names usually missing; "parse hook names" often fails',
    'the failure R45 exists to avoid',
  ],
  [
    'TanStack Devtools (alpha)',
    'framework-agnostic shell + event bus',
    'per-tool',
    'strips to 0 bytes in prod',
    'per-tool',
    'our planned host shell',
  ],
  [
    'LiveStore devtools',
    'event-log browser + SQLite playground',
    'yes (event replay)',
    'good',
    'event names by design',
    'sponsor-only license',
  ],
  [
    'state (ours, designed)',
    'patch/command stream; lazy path inspection; diffs in a Worker',
    'patch replay incl. transients filter',
    'bounded by bytes; sampling; no full-state serialisation ever',
    'devtools-maps file: names + internals always resolve, zero runtime cost (R45)',
    'subscription map answers "why did this re-render"',
  ],
];

/** One list drives both the header row and the stacked-cell labels on phones. */
const COLS = ['Tool', 'Data model', 'Time travel', 'Big-state behaviour', 'Name fidelity', 'Notes'];

export default function Devtools() {
  return (
    <div className="wrap wide">
      <header className="page">
        <T as="p" className="kicker">
          {'state · devtools (R39)'}
        </T>
        <h1>Devtools compared</h1>
        <T as="p" className="lead">
          {
            'Every tool that ships devtools, on the axes that decide whether they stay open all day or get closed after the first freeze: what crosses the process boundary, how history is bounded, and whether names resolve. Our row is the §10 design — explicitly a design, not a shipped tool.'
          }
        </T>
      </header>
      <div className="tblwrap stackable">
        <table>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r[0]}>
                <td className="name" style={{ whiteSpace: 'normal' }}>
                  {r[0]}
                </td>
                {r.slice(1).map((c, i) => (
                  // data-label is the column heading: below 640px the table stacks and
                  // each cell prints its heading above itself (see .stackable in state.css).
                  <td key={i} className={i === 0 || i === 4 ? 'traits' : undefined} data-label={COLS[i + 1]}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="why-us">
        <b>The design rule that falls out:</b>{' '}
        <T>
          {
            'never serialise the whole state; stream events/patches, inspect state lazily by path, diff in a Worker, cap history by bytes, and resolve names from a build-time devtools maps file rather than runtime reflection (R45).'
          }
        </T>
      </div>
      <footer>
        Sources: the stores & integration research reports (issue links inline in the Landscape "Why" column). See how
        we compare on this axis against every other library:{' '}
        <a href={`${href('/compare')}#cmp-devtools`}>Devtools that never freeze, names always resolve</a>.
      </footer>
    </div>
  );
}
