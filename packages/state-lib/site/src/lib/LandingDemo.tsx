import { useReducer, useState, useSyncExternalStore } from 'react';
import { createStore, derive } from './proto';
import { guideHref } from './learning';

function createDemo() {
  const store = createStore({
    items: {
      1: { text: 'Sketch the idea', done: true },
      2: { text: 'Build something useful', done: false },
      3: { text: 'Share it with the world', done: false },
    },
  });
  const remaining = derive(() => Object.values(store.state.items).filter((item) => !item.done).length);
  const toggle = store.action('tasks.toggle', (state, id: 1 | 2 | 3) => {
    state.items[id].done = !state.items[id].done;
  });
  return { store, remaining, toggle };
}

/** Real prototype operations, not an animation pretending to execute the displayed code. */
export function LandingDemo() {
  const [demo, setDemo] = useState(createDemo);
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const remaining = useSyncExternalStore(demo.remaining.subscribe, demo.remaining, demo.remaining);
  const change = (operation: () => unknown) => {
    operation();
    refresh();
  };
  const latest = demo.store.log[demo.store.cursor];
  return (
    <section className="landing-demo" aria-label="Interactive task and history demo" data-no-try>
      <div className="demo-windowbar">
        <span className="demo-live-dot" />
        <span>Live prototype</span>
        <span className="demo-windowlabel">your next big thing</span>
      </div>
      <div className="demo-workspace">
        <div className="demo-list">
          <span className="eyebrow">PROJECT / LAUNCH</span>
          <h2>Make it happen.</h2>
          <p className="demo-instruction">Check a task. Then undo it.</p>
          {([1, 2, 3] as const).map((id) => (
            <label className={`landing-task${demo.store.state.items[id].done ? ' done' : ''}`} key={id}>
              <input
                type="checkbox"
                checked={demo.store.state.items[id].done}
                onChange={() => change(() => demo.toggle(id))}
              />
              <span>{demo.store.state.items[id].text}</span>
            </label>
          ))}
          <div className="demo-history-controls">
            <button type="button" onClick={() => change(() => demo.store.undo())} disabled={!demo.store.canUndo}>
              ↶ Undo
            </button>
            <button type="button" onClick={() => change(() => demo.store.redo())} disabled={!demo.store.canRedo}>
              ↷ Redo
            </button>
            <button type="button" className="demo-reset" onClick={() => setDemo(createDemo())}>
              Reset
            </button>
          </div>
        </div>
        <div className="demo-observation">
          <span className="eyebrow">DERIVED, NOT DUPLICATED</span>
          <div className="demo-count" aria-live="polite">
            <strong>{remaining}</strong>
            <span>tasks left</span>
          </div>
          <div
            className="demo-progress"
            role="progressbar"
            aria-label="Tasks completed"
            aria-valuemin={0}
            aria-valuemax={3}
            aria-valuenow={3 - remaining}
          >
            {([0, 1, 2] as const).map((i) => (
              <span key={i} className={i < 3 - remaining ? 'complete' : ''} />
            ))}
          </div>
          <p>Change the list. This value follows it automatically.</p>
          <div className="demo-change-record">
            <span className="eyebrow">LATEST CHANGE</span>
            <code>{latest?.name ?? 'Waiting for your first edit'}</code>
            <span>
              {latest ? `${latest.patches.length} patch · inverse ready` : 'Every named action leaves a trace.'}
            </span>
          </div>
        </div>
      </div>
      <div className="demo-foot">
        <span>Same state. Derived result. Reversible changes.</span>
        <a href={guideHref('read-write')}>How does it work? →</a>
      </div>
    </section>
  );
}
