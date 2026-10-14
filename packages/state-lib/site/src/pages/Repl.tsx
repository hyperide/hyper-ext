import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { href, useRoute } from '../lib/router';
import { T } from '../lib/T';
import { EXAMPLES, TASKS, TECH_LABEL, examplesForTask, techOf, exampleById, type Example } from '../data/examples';
import { LazyEditor as CodeEditor } from '../lib/LazyEditor';
import { lookup } from '../lib/api-docs';
import { PROTO_LINES } from '../data/facts';
import { UiSlot } from './UiSlot';
import { createStepSession, safe, freezeAll, type StepSession, type Frame } from '../lib/step-session';
import { replApi } from '../lib/repl-api';
import { DEFAULT_UI, ScopeWorkbench } from '../lib/ScopeWorkbench';
export type { Frame } from '../lib/step-session';
const emptySubscribe = () => () => {};
const zero = () => 0;

export function storeOf(frame: Frame | undefined): { snapshot: unknown; log: unknown[] } | null {
  for (const value of Object.values(frame?.vars ?? {})) {
    if (value && typeof value === 'object' && '⟨store⟩' in value) {
      const s = value as { '⟨store⟩': unknown; log: unknown[] };
      return { snapshot: s['⟨store⟩'], log: s.log };
    }
  }
  return null;
}
const JSX_HELP: Record<string, string> = {
  useState: 'React hook: returns component-local state and a setter. It is not a state-lib adapter.',
  useEffect: 'React lifecycle hook. Its callback runs after a committed render, not during derive evaluation.',
  useSyncExternalStore: 'React subscription hook: subscribe + getSnapshot. This is a native React API.',
  useRef: 'React hook: a stable container whose .current does not itself trigger a render.',
  useMemo: 'React memoization hook. This is React API, not a state-lib derive.',
  React: 'React JSX runtime (createElement / Fragment), supplied by the REPL.',
  ScopeWorkbench: 'REPL helper: live controls and inspection for the top-level bindings, not a state-lib API.',
  __scope: 'The live top-level bindings of this session. Not a global variable in application code.',
  input: 'Native HTML input. checked/value are controlled by React when supplied.',
  button: 'Native HTML button. onClick is a React event handler.',
  div: 'Native HTML div element rendered by React.',
  onChange: 'React change handler. Event-local variables are not captured by the top-level debugger.',
  onClick: 'React click handler. It runs on a click, not when the component is declared.',
  target: 'The event target. Its current value exists inside the handler; not captured in this top-level trace.',
  currentTarget: 'The element whose event handler is running. Available during that event handler.',
  checked: 'Boolean checkbox state; distinct from a text input’s value.',
};
function valueType(value: unknown): string {
  if (value && typeof value === 'object' && '⟨store⟩' in value) return 'Store (recorded snapshot)';
  if (value && typeof value === 'object' && '⟨signal⟩' in value) return 'Signal (recorded value)';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'Array';
  if (value === '[function]') return 'function';
  return typeof value;
}
function describeName(
  name: string,
  values?: Record<string, unknown>,
  receiver?: string,
  source = '',
): HTMLElement | null {
  const doc = lookup(name, receiver),
    known = !!values && name in values;
  const local = new RegExp(`(?:const|let|var|function|class)\\s+${name}\\b`).test(source);
  const help =
    doc?.doc ??
    JSX_HELP[name] ??
    (local ? 'Component-local binding. Its runtime value is not captured by the top-level debugger.' : undefined);
  if (!doc && !known && !help) return null;
  const el = document.createElement('div');
  el.className = 'repl-hover';
  const sig = document.createElement('code');
  sig.className = 'repl-hover-sig';
  sig.textContent = doc?.sig ?? (known ? `${name}: ${valueType(values![name])}` : name);
  el.append(sig);
  if (help) {
    const p = document.createElement('p');
    p.textContent = help;
    el.append(p);
  }
  if (known) {
    const label = document.createElement('p');
    label.textContent = 'value at this step';
    el.append(label);
    const pre = document.createElement('pre');
    pre.textContent = safe(values![name]);
    el.append(pre);
  }
  return el;
}

function Pane({ ex, primary }: { ex: Example; primary: boolean }) {
  const [source, setSource] = useState(ex.code),
    [setup, setSetup] = useState(ex.setup),
    [uiSource, setUiSource] = useState(ex.ui ?? DEFAULT_UI);
  const [session, setSession] = useState<StepSession | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [at, setAt] = useState(-1),
    [showUiCode, setShowUiCode] = useState(false);
  const live = useRef<StepSession | null>(null),
    epoch = useRef(0);
  useSyncExternalStore(session?.subscribe ?? emptySubscribe, session?.version ?? zero, zero);
  const invalidate = () => {
    epoch.current++;
    live.current?.cancel();
    live.current = null;
    setSession(null);
    setAt(-1);
    setError('');
  };
  useEffect(
    () => () => {
      epoch.current++;
      live.current?.cancel();
    },
    [],
  );
  const begin = async () => {
    if (live.current && !live.current.done) return live.current;
    live.current?.cancel();
    const ticket = ++epoch.current;
    const s = await createStepSession(setup, source, uiSource, replApi);
    if (ticket !== epoch.current) {
      s.cancel();
      return null;
    }
    live.current = s;
    setSession(s);
    return s;
  };
  const execute = async (mode: 'run' | 'step') => {
    setBusy(true);
    setError('');
    try {
      const s = await begin();
      if (!s) return;
      if (mode === 'run') {
        await s.run();
        setAt(-1);
      } else {
        await s.step();
        setAt(s.frames.length - 1);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    invalidate();
    setSource(ex.code);
    setSetup(ex.setup);
    setUiSource(ex.ui ?? DEFAULT_UI);
  };
  const dirty = source !== ex.code || setup !== ex.setup || uiSource !== (ex.ui ?? DEFAULT_UI);
  const frames = session?.frames ?? [],
    last = frames.length - 1,
    cursor = at < 0 ? last : Math.min(at, last),
    frame = frames[cursor];
  const trace = frame?.vars ?? freezeAll(session?.scope ?? {}),
    model = storeOf(frame);
  const scrubbed = at >= 0 && at < last;
  const lines = session?.lines ?? [];
  const shownLines = at >= 0 && frame ? lines.slice(0, frame.logged) : lines;
  const jsxDescribe = (name: string, values?: Record<string, unknown>, receiver?: string) =>
    describeName(name, values, receiver, uiSource);
  const clickLine = (line: number) => {
    let index = -1;
    frames.forEach((f, i) => {
      if (f.step.line <= line) index = i;
    });
    if (index >= 0) setAt(index);
  };
  return (
    <div className={`pane${primary ? ' pane-primary' : ''}`}>
      <div className="pane-head">
        <span className={`chip on tech-${techOf(ex)}`}>{TECH_LABEL[techOf(ex)]}</span>
        <b>{ex.title}</b>
      </div>
      <p className="lnote pane-about">
        <T>{ex.about}</T>
      </p>
      <h3>scaffolding</h3>
      <CodeEditor
        value={setup}
        onChange={(value) => {
          invalidate();
          setSetup(value);
        }}
        describe={describeName}
        values={trace}
        minHeight={100}
      />
      <h3>your code</h3>
      <div className="source-editor">
        <CodeEditor
          value={source}
          onChange={(value) => {
            invalidate();
            setSource(value);
          }}
          activeLine={at >= 0 ? frame?.step.line : 0}
          describe={describeName}
          values={trace}
          onLineClick={clickLine}
          minHeight={180}
        />
      </div>
      <h3>
        <span data-export-only>the component (JSX)</span>
        <button className="linkish" onClick={() => setShowUiCode(!showUiCode)}>
          {showUiCode ? '▾' : '▸'} the component (JSX)
        </button>
      </h3>
      {showUiCode && (
        <CodeEditor
          value={uiSource}
          onChange={(value) => {
            invalidate();
            setUiSource(value);
          }}
          describe={jsxDescribe}
          values={trace}
          minHeight={140}
        />
      )}
      <pre data-export-only>{uiSource}</pre>
      <div className="txbar" data-no-export>
        <button className="tab runall" onClick={() => void execute('run')} disabled={busy}>
          {busy ? 'running…' : session && !session.done ? 'continue / run' : 'run'}
        </button>
        <button className="tab step-once" onClick={() => void execute('step')} disabled={busy || !!session?.done}>
          step
        </button>
        {(session || dirty || error) && (
          <button className="tab reset-session" onClick={reset} disabled={busy}>
            reset
          </button>
        )}
        {frames.length > 0 && (
          <>
            <button
              className="tab"
              onClick={() => setAt(Math.max(0, cursor - 1))}
              disabled={cursor <= 0}
              title="previous recorded frame"
            >
              ◀
            </button>
            <input
              className="repl-scrub"
              type="range"
              min={0}
              max={last}
              value={Math.max(0, cursor)}
              onChange={(e) => setAt(Number(e.target.value))}
              aria-label="step through the run"
            />
            <button
              className="tab"
              onClick={() => setAt(Math.min(last, cursor + 1))}
              disabled={cursor >= last}
              title="next recorded frame"
            >
              ▶
            </button>
            <span className="lnote">
              {cursor + 1}/{session?.steps.length} statements · {session?.done ? 'finished' : 'paused'}
              {frame ? ` · line ${frame.step.line}` : ''}
            </span>
          </>
        )}
      </div>
      <p className="lnote">
        Step executes one top-level statement; Run continues without debugger pauses. Scrubbing views recorded snapshots
        — it does not undo live objects. Timers and already-started asynchronous work are not frozen while paused.
      </p>
      {error && (
        <p className="repl-err" role="alert">
          {error}
        </p>
      )}
      <h3>the UI — click it</h3>
      {scrubbed && (
        <p className="lnote">
          The UI is live at the latest executed statement. The inspector below shows the selected earlier snapshot.
        </p>
      )}
      <UiSlot
        element={session?.ui}
        placeholder={
          session
            ? 'This component needs later declarations; keep stepping.'
            : 'Press Step or Run to create the live controls.'
        }
      />
      {ex.ui && session && (
        <details className="live-workbench">
          <summary>Live bindings, actions and change artefacts</summary>
          <ScopeWorkbench scope={session.scope} />
        </details>
      )}
      <h3>output</h3>
      <div className="repl-out" aria-live="polite">
        {!shownLines.length && <span className="lnote">No output at this statement.</span>}
        {shownLines.map((line, i) => (
          <div key={i} className={line.kind === 'error' ? 'repl-err' : ''}>
            {line.text}
          </div>
        ))}
      </div>
      <h3>values — hover to inspect</h3>
      <div className="repl-trace">
        {Object.entries(trace).map(([name, value]) => (
          <span className="tracechip" key={name}>
            {name}
            <span className="tracepop">
              <pre>{safe(value)}</pre>
            </span>
          </span>
        ))}
      </div>
      {model && (
        <>
          <h3>the store at this step</h3>
          <pre className="pg-code repl-state">{safe(model.snapshot)}</pre>
          <h3>transactions committed so far</h3>
          <div className="repl-txlog">
            {model.log.map((t, i) => (
              <details className="repl-tx" key={i}>
                <summary>
                  <span className="repl-txn">{i + 1}</span>
                  <code>{t && typeof t === 'object' && 'name' in t ? String(t.name ?? '') : ''}</code> ·{' '}
                  {t && typeof t === 'object' && 'patches' in t && Array.isArray(t.patches) ? t.patches.length : 0}{' '}
                  patch(es)
                </summary>
                <pre>{safe(t)}</pre>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Repl() {
  const route = useRoute();
  const wanted = route.split('/')[2] || (typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '');
  const initial = exampleById(wanted) ?? EXAMPLES[0];
  const [ex, setEx] = useState<Example>(initial);
  /** The right-hand column: the same task in another toolkit, chosen from a
   *  switcher, or nothing. One switch rather than a layout builder — the reader
   *  wants to compare, not to arrange. */
  const [otherId, setOtherId] = useState<string | null>(null);

  useEffect(() => {
    const target = exampleById(wanted);
    if (target && target.id !== ex.id) setEx(target);
  }, [wanted, ex.id]);

  const pick = (e: Example) => {
    setEx(e);
    setOtherId(null);
  };

  const others = ex.task ? examplesForTask(ex.task).filter((o) => o.id !== ex.id) : [];
  const other = others.find((o) => o.id === otherId) ?? null;

  return (
    <div className="wrap">
      <header className="page">
        <T as="p" className="kicker">
          {'state · playground (R38, R80, R81)'}
        </T>
        <h1>Run it, click it, step through it</h1>
        <T as="p" className="lead">
          {`Editable examples, actual execution steps, live controls and recorded state. The ~${PROTO_LINES}-line state prototype and the comparison libraries run in this tab. Every example has a UI or the shared live workbench. Setup, program and JSX are editable; both editors support API hints. Run untrusted code only after reviewing it: this is same-origin JavaScript, not a security sandbox. Protocol simulations are labelled; they are not a running Electric server.`}
        </T>
      </header>

      <div className="repl-pick">
        {TASKS.map((t) => {
          const forTask = examplesForTask(t.id);
          if (!forTask.length) return null;
          const here = forTask.some((e) => e.id === ex.id);
          return (
            <div key={t.id} className={`repl-task${here ? ' on' : ''}`}>
              <div className="repl-taskhead">
                <b>{t.title}</b>
                <T as="span" className="lnote">
                  {t.about}
                </T>
              </div>
              <div className="repl-techs">
                {forTask.map((e) => {
                  const sameTech = forTask.filter((o) => techOf(o) === techOf(e)).length > 1;
                  return (
                    <a
                      key={e.id}
                      className={`chip${e.id === ex.id ? ' on' : ''} tech-${techOf(e)}`}
                      href={href(`/repl/${e.id}`)}
                      onClick={() => pick(e)}
                      title={e.title}
                    >
                      {sameTech ? `${TECH_LABEL[techOf(e)]}: ${e.short ?? e.title}` : TECH_LABEL[techOf(e)]}
                    </a>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {others.length > 0 && (
        <div className="repl-sidebar-switch">
          <span className="lnote">compare with</span>
          {others.map((o) => (
            <button
              key={o.id}
              className={`chip tech-${techOf(o)}${otherId === o.id ? ' on' : ''}`}
              onClick={() => setOtherId(otherId === o.id ? null : o.id)}
              title={o.title}
            >
              {TECH_LABEL[techOf(o)]}
              {others.filter((x) => techOf(x) === techOf(o)).length > 1 ? `: ${o.short ?? o.title}` : ''}
            </button>
          ))}
          {other && (
            <button className="chip" onClick={() => setOtherId(null)}>
              ✕ close
            </button>
          )}
        </div>
      )}

      <div className={`repl-cols${other ? ' two' : ''}`}>
        <Pane key={ex.id} ex={ex} primary />
        {other && <Pane key={other.id} ex={other} primary={false} />}
      </div>

      <footer>
        Prototype source: <code>src/lib/proto.ts</code>. Examples: <code>src/data/examples.ts</code>. Step pauses after
        an actual top-level statement. Previous frames are immutable records, not reverse execution. The editor, parser
        and JSX transpiler are loaded on demand.
      </footer>
    </div>
  );
}
