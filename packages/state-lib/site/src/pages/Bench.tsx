import { T } from '../lib/T';
import { href } from '../lib/router';
import { useState } from 'react';
import { create } from 'zustand';
import { produce } from 'immer';
import { create as mutativeCreate } from 'mutative';
import { signal, createStore, deriveCollection } from '../lib/proto';

/** R28 — benchmarks that run in YOUR browser, right now, plus verified static numbers with sources. */

type Res = { name: string; ms: number; note?: string };
const fmt = (ms: number) => (ms < 1 ? ms.toFixed(3) : ms.toFixed(1));

function bench(fn: () => void, warm = 3, runs = 7): number {
  for (let i = 0; i < warm; i++) fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const a = performance.now();
    fn();
    t.push(performance.now() - a);
  }
  t.sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
}

/** Median cost of ONE call, measured over a batch: anything under the timer's
 *  resolution reads zero from `bench`, which says nothing. */
function perWrite(fn: () => void, batch = 200): number {
  return (
    bench(() => {
      for (let i = 0; i < batch; i++) fn();
    }) / batch
  );
}

const SUITES: { id: string; title: string; what: string; run: () => Res[] }[] = [
  {
    id: 'ivm',
    title: 'R66 — selector pyramid vs incremental maintenance',
    what: 'The claim R66 exists to test: does maintaining a derived view from a diff beat recomputing it? Three collection sizes, 200 single-item updates per timed sample. Reported whether it wins or loses.',
    run: () => {
      type Row = { id: number; status: 'open' | 'done'; team: number; prio: number };
      const mk = (n: number): Row[] =>
        Array.from({ length: n }, (_, i) => ({
          id: i,
          status: i % 3 === 0 ? 'done' : 'open',
          team: i % 7,
          prio: (i * 37) % 100,
        }));
      const byPrio = (a: Row, b: Row) => a.prio - b.prio || a.id - b.id;

      /** The pyramid as reselect actually behaves: the input array's identity changed,
       *  so every stage re-runs over the whole collection. */
      const recompute = (rows: Row[]) => {
        const visible = rows.filter((r) => r.status === 'open');
        const sorted = [...visible].sort(byPrio);
        const grouped = new Map<number, Row[]>();
        for (const r of sorted) {
          const g = grouped.get(r.team);
          if (g) g.push(r);
          else grouped.set(r.team, [r]);
        }
        return grouped;
      };

      /** Incremental: the same result maintained by applying one item's change.
       *  Binary search into the sorted array, splice, and patch one group. */
      const lower = (arr: Row[], r: Row) => {
        let lo = 0,
          hi = arr.length;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (byPrio(arr[m], r) < 0) lo = m + 1;
          else hi = m;
        }
        return lo;
      };
      const UPDATES = 200; // per timed sample, so sub-millisecond work is measurable
      const res: Res[] = [];
      for (const n of [100, 1000, 10000]) {
        const rows = mk(n);
        // recompute path
        {
          let k = 0;
          res.push({
            name: `recompute · ${n.toLocaleString()} rows`,
            ms: bench(
              () => {
                for (let u = 0; u < UPDATES; u++) {
                  const i = (k++ * 97) % n;
                  rows[i].status = rows[i].status === 'open' ? 'done' : 'open';
                  recompute(rows);
                }
              },
              3,
              9,
            ),
          });
        }
        // incremental path — build once, then maintain
        {
          const sorted = rows.filter((r) => r.status === 'open').sort(byPrio);
          const grouped = new Map<number, Row[]>();
          for (const r of sorted) {
            const g = grouped.get(r.team);
            if (g) g.push(r);
            else grouped.set(r.team, [r]);
          }
          let k = 0;
          res.push({
            name: `incremental · ${n.toLocaleString()} rows`,
            ms: bench(
              () => {
                for (let u = 0; u < UPDATES; u++) {
                  const i = (k++ * 97) % n;
                  const r = rows[i];
                  const wasOpen = r.status === 'open';
                  r.status = wasOpen ? 'done' : 'open';
                  if (wasOpen) {
                    const at = lower(sorted, r);
                    if (sorted[at]?.id === r.id) sorted.splice(at, 1);
                    const g = grouped.get(r.team);
                    if (g) {
                      const j = g.indexOf(r);
                      if (j >= 0) g.splice(j, 1);
                    }
                  } else {
                    sorted.splice(lower(sorted, r), 0, r);
                    const g = grouped.get(r.team);
                    if (g) {
                      const at = g.findIndex((x) => byPrio(x, r) >= 0);
                      g.splice(at < 0 ? g.length : at, 0, r);
                    } else grouped.set(r.team, [r]);
                  }
                }
              },
              3,
              9,
            ),
          });
        }
        // the real primitive — patch-driven, not hand-written for this query shape
        {
          const seed: Record<string, Row> = {};
          for (const r of mk(n)) seed[`r${r.id}`] = r;
          const store = createStore({ rows: seed });
          const view = deriveCollection<Row>(store, '/rows', {
            filter: (r) => r.status === 'open',
            sort: byPrio,
          });
          const flip = store.action('flip', (st, id: string) => {
            const row = st.rows[id];
            row.status = row.status === 'open' ? 'done' : 'open';
          });
          let k = 0;
          res.push({
            name: `deriveCollection · ${n.toLocaleString()} rows`,
            ms: bench(
              () => {
                for (let u = 0; u < UPDATES; u++) flip(`r${(k++ * 97) % n}`);
              },
              3,
              9,
            ),
            note: `real primitive · ${view.ids.peek().length} in view`,
          });
        }
      }
      return res;
    },
  },
  {
    id: 'signals',
    title: 'Signal write → 1 000 subscribers',
    what: 'One write fanning out to 1 000 effects (the "hot leaf" case).',
    run: () => {
      const res: Res[] = [];
      {
        // proto signals
        const s = signal(0);
        let sink = 0;
        const subs: (() => void)[] = [];
        for (let i = 0; i < 1000; i++)
          subs.push(
            s.subscribe(() => {
              sink++;
            }),
          );
        res.push({
          name: 'state proto signal',
          // One write to a thousand subscribers is under performance.now()'s
          // resolution on a non-isolated origin (0.1 ms on file:// and on a plain
          // https deploy alike): a single call read 0.000 ms for every row and drew
          // three identical full bars. Time a batch and divide.
          ms: perWrite(() => {
            s.set((s.peek() as number) + 1);
          }),
        });
        if (sink === 0) throw new Error('Benchmark subscribers were not notified');
        subs.forEach((u) => u());
      }
      {
        // zustand vanilla
        const st = create<{ n: number }>(() => ({ n: 0 }));
        let sink = 0;
        const subs: (() => void)[] = [];
        for (let i = 0; i < 1000; i++)
          subs.push(
            st.subscribe(() => {
              sink++;
            }),
          );
        res.push({ name: 'zustand store', ms: perWrite(() => st.setState((s) => ({ n: s.n + 1 }))) });
        if (sink === 0) throw new Error('Benchmark subscribers were not notified');
        subs.forEach((u) => u());
      }
      {
        // plain array of callbacks (vanilla floor)
        let n = 0;
        let sink = 0;
        const subs = Array.from({ length: 1000 }, () => () => {
          sink++;
        });
        res.push({
          name: 'vanilla callbacks (floor)',
          ms: perWrite(() => {
            n++;
            for (const f of subs) f();
          }),
        });
        if (sink !== n * subs.length) throw new Error('Benchmark callback count did not match writes');
      }
      return res;
    },
  },
  {
    id: 'immut',
    title: 'Immutable update: 10 000-item array, change 1 item ×100',
    what: 'The structural-sharing engines against a hand-written spread. Auto-freeze off.',
    run: () => {
      const mk = () => Array.from({ length: 10000 }, (_, i) => ({ id: i, done: false, text: `t${i}` }));
      const res: Res[] = [];
      {
        let s = mk();
        res.push({
          name: 'hand-written map+spread',
          ms: bench(() => {
            for (let k = 0; k < 100; k++) {
              const i = (k * 97) % 10000;
              s = s.map((x, j) => (j === i ? { ...x, done: !x.done } : x));
            }
          }),
        });
      }
      {
        let s = mk();
        res.push({
          name: 'immer produce',
          ms: bench(() => {
            for (let k = 0; k < 100; k++) {
              const i = (k * 97) % 10000;
              s = produce(s, (d) => {
                d[i].done = !d[i].done;
              });
            }
          }),
        });
      }
      {
        let s = mk();
        res.push({
          name: 'mutative create',
          ms: bench(() => {
            for (let k = 0; k < 100; k++) {
              const i = (k * 97) % 10000;
              s = mutativeCreate(s, (d) => {
                d[i].done = !d[i].done;
              });
            }
          }),
        });
      }
      {
        // normalized byId — what our collections do
        let s: Record<number, { id: number; done: boolean; text: string }> = Object.fromEntries(
          mk().map((x) => [x.id, x]),
        );
        res.push({
          name: 'normalized byId + spread of 1 item',
          ms: bench(() => {
            for (let k = 0; k < 100; k++) {
              const i = (k * 97) % 10000;
              s = { ...s, [i]: { ...s[i], done: !s[i].done } };
            }
          }),
          note: 'why collections are ids+byId',
        });
      }
      return res;
    },
  },
  {
    id: 'proxy',
    title: 'Proxy read vs plain read (1M reads)',
    what: 'The V8 Proxy tax the compiler removes on hot paths (§5.2).',
    run: () => {
      const res: Res[] = [];
      const obj = { a: { b: { c: 1 } } };
      const prox = new Proxy(obj, { get: (t, k) => Reflect.get(t, k) });
      let sink = 0;
      res.push({
        name: 'plain o.a.b.c',
        ms: bench(() => {
          for (let i = 0; i < 1e6; i++) sink += obj.a.b.c;
        }),
      });
      res.push({
        name: 'proxy o.a.b.c (1 trap level)',
        ms: bench(() => {
          for (let i = 0; i < 1e6; i++) sink += prox.a.b.c;
        }),
      });
      return res;
    },
  },
  {
    id: 'txp',
    title: 'state proto: 1 000 writes in one transaction',
    what: 'Batching: effects and notifications fire once at commit, not per write.',
    run: () => {
      const res: Res[] = [];
      const store = createStore({ n: {} as Record<string, number> });
      const fill = store.action('fill', (s, base: number) => {
        for (let i = 0; i < 1000; i++) s.n[`k${i}`] = base + i;
      });
      res.push({ name: '1000 proxy writes in one action', ms: bench(() => fill(Math.random())) });
      const plain: Record<string, number> = {};
      res.push({
        name: '1000 plain object writes (floor)',
        ms: bench(() => {
          for (let i = 0; i < 1000; i++) plain[`k${i}`] = i;
        }),
      });
      return res;
    },
  },
];

// Cross-tool comparisons (whole-package min+gzip, verified against npm/bundlejs on the survey date).
// state's bar is a BUDGET, not a measurement — marked as such until the spike lands.
const BUNDLE: [string, number, string][] = [
  ['state (core+collections — budget)', 7, 'target'],
  ['zustand 5', 3.5, ''],
  ['@xstate/store 4', 3.5, ''],
  ['valtio 2', 5.8, ''],
  ['jotai 2', 7.2, ''],
  ['nanostores', 2.2, ''],
  ['legend-state 3β', 11, ''],
  ['redux toolkit 2', 15.1, ''],
  ['mobx 7', 15.5, ''],
];
const STATIC_ROWS: [string, string, string][] = [
  [
    'R66 · selector pyramid vs incremental (ours, measured)',
    '10 000 rows, 200 single-item updates: recompute 110.2 ms vs the real patch-driven primitive 1.8 ms (\u224861\u00d7) \u2014 and the primitive pays for the whole store write path the recompute column does not have. A version hand-written for this one query shape reaches 280\u00d7, which is the ceiling, not the product. Still wins at 100 rows (0.3 vs 0.8 ms).',
    'our run \u00b7 M4 Pro \u00b7 headless Chromium \u00b7 2026-09-04 \u00b7 docs/research/2026-09-04-r66-ivm-vs-selectors-first-run.md',
  ],
  [
    'V8 Proxy tax (ours, measured)',
    '1 M reads through one trap level: 11.5 ms vs 1.6 ms plain \u2014 about 7\u00d7 on this machine, against the \u224813\u00d7 cited below. Both are shown rather than picking the flattering one.',
    'our run \u00b7 M4 Pro \u00b7 headless Chromium \u00b7 2026-09-04',
  ],
  [
    'Mutative vs Immer (no-freeze, 50k array)',
    '6 783 vs 5.72 ops/s — why our drafts follow Mutative\u2019s no-auto-freeze design',
    'mutative docs/performance',
  ],
  [
    'V8 Proxy trap tax',
    'get ~13×, set ~27×, ownKeys ~89× vs plain access — what the compiler removes on hot paths',
    'indexzero gist (2026 re-run)',
  ],
  [
    'postMessage payload budget',
    '≤10 KiB fits a 16 ms frame on slow phones — our replication chunking limit',
    'surma.dev/things/is-postmessage-slow',
  ],
  [
    'CRDT bundle weights',
    'Yjs 25 kB gz (JS) vs Automerge 591 kB / Loro 894 kB gz (wasm) — why CRDTs are worker-hosted plugins',
    'loro.dev/docs/performance',
  ],
];

function BundleChart() {
  const max = Math.max(...BUNDLE.map((b) => b[1]));
  return (
    <div className="benchbars">
      {BUNDLE.map(([name, kb, tag]) => (
        <div className="bb" key={name}>
          <span className="bb-name">{name}</span>
          <span className="bb-bar">
            <span
              style={{ width: `${Math.max(3, (kb / max) * 100)}%`, background: tag ? 'var(--amber)' : 'var(--accent)' }}
            />
          </span>
          <span className="bb-ms">{kb.toFixed(1)} kB</span>
        </div>
      ))}
    </div>
  );
}

export default function Bench() {
  const [results, setResults] = useState<Record<string, Res[]>>({});
  const [running, setRunning] = useState<string | null>(null);
  const run = (id: string) => {
    setRunning(id);
    setTimeout(() => {
      const suite = SUITES.find((s) => s.id === id)!;
      setResults((r) => ({ ...r, [id]: suite.run() }));
      setRunning(null);
    }, 30);
  };
  /** Sequential, one timeout apart, so the page stays responsive and each suite is timed alone. */
  const runAll = () => {
    const queue = SUITES.map((x) => x.id);
    const step = () => {
      const id = queue.shift();
      if (!id) return setRunning(null);
      setRunning(id);
      setTimeout(() => {
        const suite = SUITES.find((x) => x.id === id)!;
        setResults((r) => ({ ...r, [id]: suite.run() }));
        step();
      }, 30);
    };
    step();
  };
  return (
    <div className="wrap wide">
      <header className="page">
        <T as="p" className="kicker">
          {'state · benchmarks (R28)'}
        </T>
        <h1>Benchmarks</h1>
        <p className="lead">
          Two kinds of numbers, kept separate on purpose: <b>live</b> — run in your browser right now, on your hardware
          (median of 7 runs after warmup); and <b>verified static</b> — published results with sources. Coming:
          data-type × volume × operation grid and real-world scenarios per R28, wired into the playground examples.
        </p>
        <p className="lead">
          <b>The one worth running first</b> is R66 at the top: a filter-sort-group view over 10 000 rows, brought up to
          date after one row changes. Recomputing it — what a memoized selector chain does once the array identity has
          changed — took <b>110 ms</b> on the machine that recorded this, against <b>1.8 ms</b> maintained from patches
          by a real primitive that also pays for the whole transaction pipeline. One checkbox, seven dropped frames.
          This is the same selector-pyramid-vs-query argument as{' '}
          <a href={`${href('/concepts')}#queries`}>the concept</a> — this page is the measured number, that page is why
          it happens. What the number does and does not license is written up in{' '}
          <code>docs/research/2026-09-04-r66-ivm-vs-selectors-first-run.md</code>, at greater length than the number.
        </p>
        <p>
          <button className="tab runall" onClick={runAll} disabled={running !== null}>
            {running ? 'running…' : 'Run every suite'}
          </button>
        </p>
      </header>
      {SUITES.map((s) => {
        const rs = results[s.id];
        const max = rs ? Math.max(...rs.map((r) => r.ms)) : 0;
        return (
          <section className="layer" key={s.id}>
            <div className="lhead">
              <h2>{s.title}</h2>
              <span className="lnote">{s.what}</span>
              <button className="tab" onClick={() => run(s.id)} disabled={running === s.id}>
                {running === s.id ? 'running…' : rs ? 're-run' : 'run'}
              </button>
            </div>
            {!rs && running !== s.id && <p className="lnote benchidle">Not run yet — press run.</p>}
            {rs && (
              <div className="benchbars">
                {rs.map((r) => (
                  <div className="bb" key={r.name}>
                    <span className="bb-name">
                      {r.name}
                      {r.note && <em> — {r.note}</em>}
                    </span>
                    <span className="bb-bar">
                      <span style={{ width: `${Math.max(2, (r.ms / max) * 100)}%` }} />
                    </span>
                    <span className="bb-ms">{fmt(r.ms)} ms</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <h2>Store bundle sizes, side by side</h2>
      <p className="lead">
        Whole-package min+gzip, verified on the survey date. The amber bar is state&rsquo;s CI-enforced <b>budget</b>,
        not a measurement — it stays amber until the spike ships a number.
      </p>
      <BundleChart />
      <h2>Cross-tool facts the design leans on</h2>
      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: '20%' }}>Measurement</th>
              <th style={{ width: '52%' }}>Result — and what it decided</th>
              <th style={{ width: '28%' }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {STATIC_ROWS.map(([a, b, c]) => (
              <tr key={a}>
                <td>{a}</td>
                <td>{b}</td>
                <td className="src">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer>
        Microbenchmarks lie in isolation — treat them as bounds, not verdicts. Next: the full data-type × volume ×
        operation grid and krausest-style scenario runs (R28), wired into the Playground examples.
      </footer>
    </div>
  );
}
