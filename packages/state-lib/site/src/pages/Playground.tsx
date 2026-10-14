import { T } from '../lib/T';
import { href } from '../lib/router';
import { PROTO_LINES } from '../data/facts';
import { Code } from '../lib/Code';
import { type ReactNode, memo, useEffect, useReducer, useRef, useState } from 'react';
import { create } from 'zustand';
import { createStore } from '../lib/proto';

/** R38 — live examples: same UI, three state approaches, live state inspector,
 *  per-component render counters, transaction log for the `state` prototype. */

// ---------- render counters (external mutable object; no React state → no cascades) ----------
const counters: Record<string, { list: number; row: number }> = {
  useState: { list: 0, row: 0 },
  zustand: { list: 0, row: 0 },
  proto: { list: 0, row: 0 },
};
function useRenders(app: string, key: 'list' | 'row') {
  const n = useRef(0);
  n.current++;
  counters[app][key]++;
  return n.current;
}
function Meter({ app }: { app: string }) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const t = setInterval(force, 300);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="pg-meter">
      list renders: <b>{counters[app].list}</b> · row renders: <b>{counters[app].row}</b>
    </div>
  );
}
const Badge = ({ n }: { n: number }) => (
  <span className="rc" title="renders of this component">
    {n}
  </span>
);

// ---------- approach: React useState (lifted) ----------
function UseStateDemo() {
  const [items, setItems] = useState(() => seed());
  return (
    <Rows
      app="useState"
      items={items}
      toggle={(id: number) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, done: !x.done } : x)))}
      renderRow={(item: Item, toggle: (id: number) => void) => <RowPlain key={item.id} item={item} toggle={toggle} />}
      label="useState"
    />
  );
}
function RowPlain({ item, toggle }: { item: Item; toggle: (id: number) => void }) {
  const n = useRenders('useState', 'row');
  return (
    <label className="rowd">
      <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} />
      {item.text}
      <Badge n={n} />
    </label>
  );
}

// ---------- approach: Zustand ----------
type Item = { id: number; text: string; done: boolean };
const useZ = create<{ items: Item[]; toggle: (id: number) => void }>((set) => ({
  items: seed(),
  toggle: (id) => set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, done: !x.done } : x)) })),
}));
function ZustandDemo() {
  const items = useZ((s) => s.items);
  const toggle = useZ((s) => s.toggle);
  return (
    <Rows
      app="zustand"
      items={items}
      toggle={toggle}
      renderRow={(item: Item) => <ZRow key={item.id} id={item.id} />}
      label="zustand"
    />
  );
}
const ZRow = memo(function ZRow({ id }: { id: number }) {
  const item = useZ((s) => s.items.find((x) => x.id === id)!); // selector re-runs on every store change; new object identity → memo can't save you without care
  const toggle = useZ((s) => s.toggle);
  const n = useRenders('zustand', 'row');
  return (
    <label className="rowd">
      <input type="checkbox" checked={item.done} onChange={() => toggle(id)} />
      {item.text}
      <Badge n={n} />
    </label>
  );
});

// ---------- approach: state prototype ----------
const store = createStore({
  items: Object.fromEntries(seed().map((i) => [i.id, i])) as Record<string, Item>,
  ids: seed().map((i) => i.id),
  query: '',
});
const toggleAction = store.action('todos.toggle', (s, id: number) => {
  s.items[id].done = !s.items[id].done;
});
function ProtoDemo() {
  const ids = store.usePath<number[]>('/ids');
  const n = useRenders('proto', 'list');
  return (
    <div>
      <div className="demo-head">
        state proto <Badge n={n} />
      </div>
      {ids.map((id) => (
        <PRow key={id} id={id} />
      ))}
    </div>
  );
}
function PRow({ id }: { id: number }) {
  const done = store.usePath<boolean>(`/items/${id}/done`);
  const text = store.usePath<string>(`/items/${id}/text`);
  const n = useRenders('proto', 'row');
  return (
    <label className="rowd">
      <input type="checkbox" checked={done} onChange={() => toggleAction(id)} />
      {text}
      <Badge n={n} />
    </label>
  );
}

// ---------- shared UI ----------
function seed(): Item[] {
  return [1, 2, 3, 4, 5].map((i) => ({ id: i, text: `item ${i}`, done: i % 2 === 0 }));
}
function Rows({
  app,
  items,
  toggle,
  renderRow,
  label,
}: {
  app: string;
  items: Item[];
  toggle: (id: number) => void;
  renderRow: (item: Item, toggle: (id: number) => void) => ReactNode;
  label: string;
}) {
  const n = useRenders(app, 'list');
  return (
    <div>
      <div className="demo-head">
        {label} <Badge n={n} />
      </div>
      {items.map((it: Item) => renderRow(it, toggle))}
    </div>
  );
}

const CODE: Record<string, string> = {
  useState: `const [items, setItems] = useState(seed)
const toggle = id => setItems(xs =>
  xs.map(x => x.id === id ? {...x, done: !x.done} : x))
// parent re-renders → the whole list maps again;
// every row re-renders (new object identities)`,
  zustand: `const useZ = create(set => ({ items: seed(),
  toggle: id => set(s => ({ items: s.items.map(...) })) }))
// each row: useZ(s => s.items.find(x => x.id === id))
// selector re-runs on EVERY store change and returns a
// new (or found) object — correctness depends on you
// choosing selectors + memo carefully`,
  proto: `const store = createStore({ items: byId, ids })
const toggle = store.action('todos.toggle',
  (s, id) => { s.items[id].done = !s.items[id].done })
// row subscribes to /items/<id>/done only.
// one click → ONE row re-renders; list untouched;
// the action lands in the transaction log as patches`,
};

function LocalInput() {
  const [q, setQ] = useState('');
  const n = useRenders('useState', 'row');
  return (
    <div>
      <input className="pg-input" value={q} placeholder="type here…" onChange={(e) => setQ(e.target.value)} />
      <div className="lnote">
        value: “{q}” <Badge n={n} />
      </div>
    </div>
  );
}
function GlobalInput() {
  const q = store.usePath<string>('/query');
  const n = useRenders('proto', 'row');
  return (
    <div>
      <input
        className="pg-input"
        value={q ?? ''}
        placeholder="type here…"
        onChange={(e) => store.setTransient('/query', e.target.value)}
      />
      <div className="lnote">
        value: “{q}” <Badge n={n} /> — watch the log coalesce below
      </div>
    </div>
  );
}

/** §4.11 — optimistic write, then a server that says no. The rollback reuses the same
 *  inverse patches undo uses; there is no second mechanism and no snapshot is taken. */
const optimisticRename = store.optimistic(
  'todos.rename',
  (s, id: number, text: string) => {
    s.items[id].text = text;
  },
  (_id: number, _text: string) =>
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('server said no')), 900)),
);
const confirmedRename = store.optimistic(
  'todos.rename',
  (s, id: number, text: string) => {
    s.items[id].text = text;
  },
  (_id: number, _text: string) => new Promise((resolve) => setTimeout(resolve, 900)),
);

function OptimisticDemo() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => store.onPending(force), []);
  const text = store.usePath<string>('/items/1/text');
  const inFlight = store.pending.length > 0;
  return (
    <div className="pg-optim">
      <h3>
        <T>{'Optimistic writes and rollback (§4.11)'}</T>
      </h3>
      <T as="p" className="lnote">
        {
          'The write lands instantly and the transaction is marked in flight. When the server answers, it is either confirmed or reversed — by applying the same inverse patches undo applies. Watch the log below: a rejection appends a "rolled back" transaction rather than quietly erasing the first one, so the log still says what the user actually saw.'
        }
      </T>
      <div className="pg-optim-row">
        <code>items/1/text = {JSON.stringify(text)}</code>
        {inFlight && <span className="status wip">in flight…</span>}
      </div>
      <div className="txbar">
        <button
          className="tab"
          disabled={inFlight}
          onClick={() => {
            confirmedRename(1, 'renamed ✓').catch(() => {});
            force();
          }}
        >
          rename — server accepts
        </button>
        <button
          className="tab"
          disabled={inFlight}
          onClick={() => {
            optimisticRename(1, 'renamed ✗').catch(() => {});
            force();
          }}
        >
          rename — server rejects
        </button>
      </div>
    </div>
  );
}

function LogPanel() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => store.onLog(force), []);
  const cursor = store.cursor;
  return (
    <div className="pg-grid2">
      <div>
        <h3>snapshot()</h3>
        <Code>{JSON.stringify(store.snapshot(), null, 1)}</Code>
      </div>
      <div>
        <h3>
          <T>{'transaction log — commands + patches (§4.4)'}</T>
        </h3>
        <div className="txbar">
          <button
            className="tab"
            onClick={() => {
              store.undo();
              force();
            }}
            disabled={!store.canUndo}
          >
            ← undo
          </button>
          <button
            className="tab"
            onClick={() => {
              store.redo();
              force();
            }}
            disabled={!store.canRedo}
          >
            redo →
          </button>
          <T className="lnote">
            {
              'Undo applies the inverse patches of one transaction — O(the change), not O(the state). No snapshot is stored. Click any row to travel there.'
            }
          </T>
        </div>
        <div className="txlog">
          {store.log
            .map((t, i) => [t, i] as const)
            .reverse()
            .slice(0, 14)
            .map(([t, i]) => (
              <div
                className={`txrow${i === cursor ? ' txnow' : ''}${i > cursor ? ' txundone' : ''}`}
                key={t.id}
                onClick={() => {
                  store.jumpTo(i);
                  force();
                }}
                title={i > cursor ? 'undone — click to redo to here' : 'click to travel here'}
              >
                <span className="txname">{t.name}</span>
                {t.patches.map((patch, k) => (
                  <code key={k}>
                    {patch.op} {patch.path} = {JSON.stringify(patch.value)}
                  </code>
                ))}
                {i === cursor && <span className="txhere">you are here</span>}
              </div>
            ))}
          {!store.log.length && <div className="lnote">click a checkbox in the third column…</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * The live-comparison half of the playground (R38): the same UI built three
 * ways with render counters, the keystroke scenario, the optimistic demo, and
 * the transaction log with time travel.
 *
 * Exported as a section rather than a page because the playground and the REPL
 * are one page now — a reader who has just stepped through a transaction wants
 * to see the same mechanism driving a real UI immediately below it, not behind
 * a second tab.
 */
export function Comparison() {
  return (
    <>
      <h2 id="three-approaches">Same UI, three approaches</h2>
      <p className="lead">
        Click checkboxes and watch the render counters (little numbers next to each component). The <b>state proto</b>{' '}
        column runs the same ~{PROTO_LINES}-line prototype the editor above runs: per-path signals, proxy writes inside
        actions, a patch-emitting transaction log. Every write also records the patches that undo it, so the log below
        is not a read-out — it is the history: <b>undo, redo and time travel are the same mechanism</b>, applying
        patches between two points. Click any row to jump there.
      </p>
      <div className="pg-grid">
        {(['useState', 'zustand', 'proto'] as const).map((app) => (
          <div className="pg-col" key={app}>
            <Code>{CODE[app]}</Code>
            <div className="pg-demo">
              {app === 'useState' ? <UseStateDemo /> : app === 'zustand' ? <ZustandDemo /> : <ProtoDemo />}
            </div>
            <Meter app={app} />
            {app === 'proto' && (
              <div className="pg-meter">
                <a href={href('/repl/read-write')}>the same store, in the editor above</a>
              </div>
            )}
          </div>
        ))}
      </div>
      <h2>Scenario: every keystroke is global state</h2>
      <div className="pg-grid">
        <div className="pg-col">
          <Code>{`// useState: fine locally — but invisible to
// devtools, tests, recordings; lost on unmount
const [q, setQ] = useState('')`}</Code>
          <div className="pg-demo">
            <LocalInput />
          </div>
          <div className="pg-meter">state lives and dies inside one component</div>
        </div>
        <div className="pg-col">
          <Code>{`// state: global, but transient —
// one subscriber re-renders per keystroke,
// log entries coalesce per animation frame
const q = store.usePath('/query')
onInput={e => store.setTransient('/query', e.target.value)}`}</Code>
          <div className="pg-demo">
            <GlobalInput />
          </div>
          <div className="pg-meter">
            visible everywhere · coalesced in the log below ·{' '}
            <a href={href('/repl/transient')}>run this in the editor above</a>
          </div>
        </div>
      </div>
      <OptimisticDemo />
      <h2>Live state &amp; transaction log (state proto)</h2>
      <LogPanel />
      <div className="why-us">
        <b>What this shows:</b> useState re-renders the list + all 5 rows per click (parent-driven); zustand re-renders
        what your selectors let through — its counters here reflect one common selector idiom, and the Compare page
        walks the other idioms; the proto re-renders exactly one row and logs a named command with RFC-6902-style
        patches — undo, devtools and replication all hang off that log. Numbers are live from this page, not staged.
      </div>
    </>
  );
}
