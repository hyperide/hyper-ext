import React from 'react';
import { href } from '../lib/router';
import { T } from '../lib/T';
import { LIBS, CATS } from '../data/compare';
import { ROWS, WHY, V } from '../data/landscape';
import { linkify } from '../lib/linkify';

/** R27 — one page per competitor: what it is, what we take from it, and how every
 *  compared axis actually differs. Assembled from the same single sources the
 *  Landscape and Compare pages use (R64) plus the source-level deep dives. */

/** Landscape row fields, in order (see data/landscape.ts). */
const enum F {
  layer,
  name,
  pkg,
  version,
  size,
  license,
  what,
  take,
  verdict,
  note,
}

/** Where a library's source-level deep dive lives, when one was written. */
const DIVE: Record<string, { page: string; anchor: string }> = {
  // Slugs must match what useHeadings derives from the heading text (lib/Toc.tsx).
  zustand: { page: '/dive-stores', anchor: 'h-zustand-5' },
  valtio: { page: '/dive-stores', anchor: 'h-valtio-2' },
  jotai: { page: '/dive-stores', anchor: 'h-jotai-2-post-2-20-internals-rework' },
  legend: { page: '/dive-stores', anchor: 'h-legend-state-v3-beta' },
};

/** Compare-table ids → the name used in the landscape matrix. Exported so Landscape.tsx can
 *  build the reverse lookup and link a row's library name back to its /lib/<id> page (R64 —
 *  same source data, so the mapping lives in exactly one place). */
export const LANDSCAPE_NAME: Record<string, string> = {
  zustand: 'Zustand',
  rtk: 'Redux Toolkit',
  jotai: 'Jotai',
  valtio: 'Valtio',
  mobx: 'MobX 7 (+MST/keystone)',
  legend: 'Legend-State',
  xstate: '@xstate/store v4',
};

const SCORE = ['not offered', 'partial', 'good', 'best in class'];
const GLYPH = ['—', '◐', '●', '★'];

function landscapeRow(libId: string) {
  const name = LANDSCAPE_NAME[libId];
  return ROWS.find((r) => r[F.name] === name);
}

/** One compared axis, side by side: theirs, ours, and why we chose differently. */
function AxisRow({
  libId,
  libName,
  axis,
}: {
  libId: string;
  libName: string;
  axis: (typeof CATS)[number]['axes'][number];
}) {
  const theirs = axis.cells[libId];
  const ours = axis.cells.state;
  if (!theirs || !ours) return null;
  const gap = ours[0] - theirs[0];
  return (
    <div className="cmp-axis">
      <h4>
        {axis.axis}
        {axis.demo && (
          <>
            {' '}
            · <a href={href(`/repl/${axis.demo}`)}>see it live</a>
          </>
        )}
      </h4>
      <div className="cmp-sbs">
        <div className={`cmp-side${gap > 0 ? '' : ' cmp-even'}`}>
          <span className="cmp-who">{libName}</span>
          <span className="cmp-glyph" title={SCORE[theirs[0]]}>
            {GLYPH[theirs[0]]}
          </span>
          <T>{theirs[1]}</T>
        </div>
        <div className="cmp-side cmp-ours">
          <span className="cmp-who">state</span>
          <span className="cmp-glyph" title={SCORE[ours[0]]}>
            {GLYPH[ours[0]]}
          </span>
          <T>{ours[1]}</T>
          <span className={`tag t-${axis.status}`}>{axis.status}</span>
        </div>
      </div>
      {gap > 0 && (
        <p className="cmp-why">
          <T>{axis.why}</T>
        </p>
      )}
    </div>
  );
}

export default function Library({ id }: { id: string }) {
  const lib = LIBS.find((l) => l.id === id);
  if (!lib || id === 'state') {
    return (
      <div className="wrap">
        <header className="page">
          <p className="kicker">state · compare</p>
          <h1>Per-library comparisons</h1>
          <p className="lead">
            Pick a library to see what it is, what we take from it, and how each compared axis differs.
          </p>
        </header>
        <ul className="liblist">
          {LIBS.filter((l) => l.id !== 'state').map((l) => (
            <li key={l.id}>
              <a href={href(`/lib/${l.id}`)}>{l.name}</a> <span className="muted">{l.note}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const row = landscapeRow(id);
  const why = row ? WHY[row[F.name]] : undefined;
  const dive = DIVE[id];
  const axes = CATS.flatMap((c) => c.axes.filter((a) => a.cells[id] && a.cells.state));
  const wins = axes.filter((a) => a.cells.state[0] > a.cells[id][0]).length;
  const theirWins = axes.filter((a) => a.cells.state[0] < a.cells[id][0]);
  const level = axes.filter((a) => a.cells.state[0] === a.cells[id][0]);
  const unbuilt = axes.filter((a) => a.cells.state[0] > a.cells[id][0] && a.status !== 'prototyped').length;

  return (
    <div className="wrap">
      <header className="page">
        <p className="kicker">state · compare</p>
        <h1>state vs {lib.name}</h1>
        {row && (
          <p className="lead">
            <code>{row[F.pkg]}</code> · {row[F.version]} · {row[F.size]} · {row[F.license]} ·{' '}
            {/* The verdict word alone ("context") explained nothing; the title
                says what the landscape verdict means. */}
            <span
              className={`verdict v-${row[F.verdict]}`}
              title={`Landscape verdict: ${V[row[F.verdict]]} — see the Landscape page legend`}
            >
              {V[row[F.verdict]]}
            </span>
          </p>
        )}
        <p className="lead">
          Across {axes.length} compared axes we rate ourselves ahead on {wins}
          {theirWins.length > 0 ? `, behind on ${theirWins.length}` : ''}
          {level.length > 0 ? `, level on ${level.length}` : ''}. Of the {wins} we lead,{' '}
          <b>{unbuilt} are specified but not yet built</b> — every row carries its status, and &ldquo;designed&rdquo; is
          a claim to verify rather than a result to trust.
        </p>
        {/* The glyphs carried their meaning only in a title tooltip; on a phone
            there is no hover, and 36 rows of ◐ ● ★ with no key is a puzzle. */}
        <p className="lnote cmp-legend">
          {GLYPH.map((g, k) => (
            <span key={g}>
              <b>{g}</b> {SCORE[k]}
              {k < GLYPH.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
      </header>

      {(theirWins.length > 0 || level.length > 0) && (
        <section className="lib-block honest">
          <h2>Where {lib.name} is ahead of us, or level</h2>
          <ul>
            {theirWins.map((a) => (
              <li key={a.id}>
                <b>{a.axis}</b> — <T>{a.cells[id][1]}</T> <span className="muted">(ours: {a.cells.state[1]})</span>
              </li>
            ))}
            {level.map((a) => (
              <li key={a.id}>
                {a.axis} — level: <T>{a.cells[id][1]}</T>
              </li>
            ))}
          </ul>
        </section>
      )}

      {row && (
        <section className="lib-block">
          <h2>What it is</h2>
          <p dangerouslySetInnerHTML={{ __html: linkify(row[F.what]) }} />
          <h2>What we take from it</h2>
          <p dangerouslySetInnerHTML={{ __html: linkify(row[F.take]) }} />
          {why && <p dangerouslySetInnerHTML={{ __html: linkify(why) }} />}
          {row[F.note] && <p className="lnote" dangerouslySetInnerHTML={{ __html: linkify(row[F.note]) }} />}
          {dive && (
            <p className="lnote">
              Read at the source level: <a href={`${href(dive.page)}#${dive.anchor}`}>deep dive into {lib.name}</a> —
              module map, quoted code, and what a migration codemod can and cannot take automatically.
            </p>
          )}
        </section>
      )}

      {CATS.map((cat) => {
        const rows = cat.axes.filter((a) => a.cells[id] && a.cells.state);
        if (!rows.length) return null;
        return (
          <section className="lib-block" key={cat.name}>
            <h2>{cat.name}</h2>
            {rows.map((a) => (
              <AxisRow key={a.id} libId={id} libName={lib.name} axis={a} />
            ))}
          </section>
        );
      })}

      <footer>
        Sources: the landscape matrix (<code>src/data/landscape.ts</code>) and the comparison table (
        <code>src/data/compare.ts</code>) — the same data the <a href={href('/landscape')}>Landscape</a> and{' '}
        <a href={href('/compare')}>Compare</a> pages render (R64).
      </footer>
    </div>
  );
}
