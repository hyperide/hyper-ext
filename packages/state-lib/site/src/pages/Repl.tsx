import {
  readWorkbenchDraft,
  saveWorkbenchDraft,
  clearWorkbenchDraft,
  flushWorkbenchDraft,
  type DraftPersistence,
} from '../lib/workbench-draft';
import { LiveStateTree } from '../lib/LiveStateTree';
import { SiteIcon } from '../lib/SiteIcon';
import { useEffect, useRef, useState, useSyncExternalStore, useMemo } from 'react';
import { href, useRoute } from '../lib/router';
import { T } from '../lib/T';
import { EXAMPLES, TASKS, TECH_LABEL, examplesForTask, techOf, exampleById, type Example } from '../data/examples';
import { LazyEditor as CodeEditor } from '../lib/LazyEditor';
import { lookup } from '../lib/api-docs';
import { PROTO_LINES } from '../data/facts';
import { UiSlot } from './UiSlot';
import { createStepSession, safe, freezeAll, type StepSession, type Frame, type OutputLine } from '../lib/step-session';
import { replApi } from '../lib/repl-api';
import { DEFAULT_UI, ScopeWorkbench } from '../lib/ScopeWorkbench';
import { GUIDES } from '../lib/learning';
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

function OutputLines({ lines }: { lines: OutputLine[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className={line.kind === 'error' ? 'repl-err' : ''}>
          {line.text}
        </div>
      ))}
    </>
  );
}
function Pane({ ex, primary }: { ex: Example; primary: boolean }) {
  const guide = GUIDES[ex.id];
  const saved = useRef(readWorkbenchDraft(ex, DEFAULT_UI));
  const [source, setSource] = useState(saved.current.source),
    [setup, setSetup] = useState(saved.current.setup),
    [uiSource, setUiSource] = useState(saved.current.ui);
  const [session, setSession] = useState<StepSession | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [at, setAt] = useState(-1);
  const [mode, setMode] = useState<'manual' | 'demo'>('manual');
  const [command, setCommand] = useState(saved.current.command);
  const [commandLines, setCommandLines] = useState<OutputLine[]>([]);
  const [draftPersisted, setDraftPersisted] = useState<DraftPersistence>('saved');
  const operationId = useRef(0);
  const operationActive = useRef(false);
  useEffect(() => {
    let mounted = true;
    if (source === ex.code && setup === ex.setup && uiSource === (ex.ui ?? DEFAULT_UI) && !command) {
      clearWorkbenchDraft(ex.id);
      setDraftPersisted('saved');
    } else
      setDraftPersisted(
        saveWorkbenchDraft(ex.id, { source, setup, ui: uiSource, command }, (status) => {
          if (mounted) setDraftPersisted(status);
        }),
      );
    return () => {
      mounted = false;
    };
  }, [ex.id, ex.code, ex.setup, ex.ui, source, setup, uiSource, command]);
  useEffect(
    () => () => {
      flushWorkbenchDraft(ex.id);
    },
    [ex.id],
  );
  const [notice, setNotice] = useState('Choose manual setup or a scripted demo. Nothing executes on arrival.');
  const applied = useRef('');
  const commandSession = useRef<StepSession | null>(null);
  const commandCleanups = useRef(new Set<() => void>());
  const clearCommandResources = () => {
    for (const stop of [...commandCleanups.current].reverse()) {
      try {
        stop();
      } catch {
        /* Release every resource even when a user cleanup throws. */
      }
    }
    commandCleanups.current.clear();
  };
  const live = useRef<StepSession | null>(null),
    epoch = useRef(0);
  useSyncExternalStore(session?.subscribe ?? emptySubscribe, session?.version ?? zero, zero);
  const invalidate = () => {
    epoch.current++;
    operationId.current++;
    operationActive.current = false;
    setBusy(false);
    clearCommandResources();
    live.current?.cancel();
    commandSession.current?.cancel();
    commandSession.current = null;
    live.current = null;
    setSession(null);
    setAt(-1);
    setError('');
    setCommandLines([]);
  };
  useEffect(
    () => () => {
      epoch.current++;
      operationId.current++;
      clearCommandResources();
      live.current?.cancel();
      commandSession.current?.cancel();
    },
    [],
  );
  const begin = async (restart = false) => {
    const signature = JSON.stringify([setup, source, uiSource]);
    if (!restart && live.current && !live.current.done && applied.current === signature) return live.current;
    clearCommandResources();
    live.current?.cancel();
    commandSession.current?.cancel();
    commandSession.current = null;
    live.current = null;
    applied.current = '';
    setSession(null);
    setAt(-1);
    const ticket = ++epoch.current;
    const s = await createStepSession(setup, source, uiSource, replApi);
    if (ticket !== epoch.current) {
      s.cancel();
      return null;
    }
    live.current = s;
    applied.current = signature;
    setSession(s);
    return s;
  };
  const execute = async (operation: 'run' | 'step' | 'initialize') => {
    if (operationActive.current) return;
    const owner = ++operationId.current;
    operationActive.current = true;
    setBusy(true);
    setError('');
    try {
      const s = await begin(operation === 'initialize');
      if (!s || owner !== operationId.current) return;
      if (operation === 'initialize') {
        setMode('manual');
        setNotice('Setup ran; the demo script did not. Use the real screen or an action template.');
        setAt(-1);
      } else if (operation === 'run') {
        await s.run();
        if (owner !== operationId.current) return;
        const failure = s.lines.find((line) => line.kind === 'error');
        if (failure) throw new Error(failure.text);
        setAt(-1);
        setNotice(
          'The visible demo script ran. Compare the final screen and live tree; the debugger keeps prior frames separately.',
        );
      } else {
        await s.step();
        if (owner !== operationId.current) return;
        setAt(s.frames.length - 1);
      }
    } catch (e) {
      if (owner === operationId.current) setError(String(e));
    } finally {
      if (owner === operationId.current) {
        setBusy(false);
        operationActive.current = false;
      }
    }
  };
  const runCommand = async () => {
    if (!session || operationActive.current || !command.trim()) return;
    const ticket = epoch.current,
      owner = ++operationId.current;
    const owned = new Set<() => void>();
    let execution: StepSession | null = null;
    const releaseOwned = () => {
      for (const stop of [...owned].reverse()) {
        try {
          stop();
        } catch {
          /* Continue cleanup. */
        }
      }
    };
    const register = (cleanup: () => void) => {
      let released = false;
      const stop = () => {
        if (released) return;
        released = true;
        owned.delete(stop);
        commandCleanups.current.delete(stop);
        cleanup();
      };
      if (ticket !== epoch.current || owner !== operationId.current) {
        stop();
        return;
      }
      owned.add(stop);
      commandCleanups.current.add(stop);
    };
    operationActive.current = true;
    setBusy(true);
    setError('');
    setCommandLines([]);
    try {
      execution = await createStepSession('', command, 'return null', (log) => ({
        ...replApi(log, register),
        ...session.scope,
      }));
      if (ticket !== epoch.current || owner !== operationId.current) {
        execution.cancel();
        releaseOwned();
        return;
      }
      commandSession.current = execution;
      await execution.run();
      if (ticket !== epoch.current || owner !== operationId.current) return;
      setCommandLines([...execution.lines]);
      const failure = execution.lines.find((line) => line.kind === 'error');
      if (failure) {
        releaseOwned();
        setError(failure.text);
      } else
        setNotice(
          'Your command ran on the live model. Resources it creates stay owned by this example until Apply, Reset or leaving it.',
        );
    } catch (failure) {
      releaseOwned();
      if (ticket === epoch.current && owner === operationId.current) setError(String(failure));
    } finally {
      execution?.cancel();
      if (commandSession.current === execution) commandSession.current = null;
      if (ticket === epoch.current && owner === operationId.current) {
        setBusy(false);
        operationActive.current = false;
      }
    }
  };
  const reset = () => {
    if (dirty && !window.confirm('Discard your edited code and restore this template?')) return;
    clearWorkbenchDraft(ex.id);
    invalidate();
    setCommand('');
    setSource(ex.code);
    setSetup(ex.setup);
    setUiSource(ex.ui ?? DEFAULT_UI);
  };
  const dirty = source !== ex.code || setup !== ex.setup || uiSource !== (ex.ui ?? DEFAULT_UI) || !!command;
  const needsApply = !!session && applied.current !== JSON.stringify([setup, source, uiSource]);
  const frames = session?.frames ?? [],
    last = frames.length - 1,
    cursor = at < 0 ? last : Math.min(at, last),
    frame = frames[cursor];
  const trace = useMemo(() => frame?.vars ?? freezeAll(session?.scope ?? {}), [session, frame]),
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
    <div className={`pane${primary ? ' pane-primary' : ''}`} data-example={ex.id} id={primary ? 'guide' : undefined}>
      <div className="pane-head">
        <span className={`chip on tech-${techOf(ex)}`}>{TECH_LABEL[techOf(ex)]}</span>
        <b>{ex.title}</b>
      </div>
      <div className="workbench-mode" aria-label="Interaction mode">
        <button aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>
          Work manually
        </button>
        <button aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}>
          Scripted demo
        </button>
      </div>
      <div className="lesson-actions" data-no-export>
        {mode === 'manual' && (
          <button className="tab initialize-example" disabled={busy} onClick={() => void execute('initialize')}>
            {session ? 'Apply setup / restart' : 'Initialize for manual use'}
          </button>
        )}

        <button
          className="tab runall"
          hidden={mode !== 'demo'}
          type="button"
          disabled={busy}
          onClick={() => void execute('run')}
        >
          {busy
            ? 'Starting…'
            : session && !session.done
              ? 'Continue demo'
              : session
                ? 'Restart demo'
                : 'Run demo script'}
        </button>
        <button
          className="tab reset-session"
          type="button"
          disabled={busy || (!session && !dirty && !error)}
          onClick={reset}
        >
          Reset example
        </button>
        {busy && (
          <button className="tab" type="button" onClick={invalidate}>
            Stop
          </button>
        )}
        <span className="lesson-status" role="status">
          {busy
            ? 'Preparing the live controls'
            : session
              ? 'Ready — try the controls below'
              : 'Nothing runs until you start it'}
        </span>
      </div>
      <p className="draft-status">
        {draftPersisted === 'saved'
          ? 'Your edits stay in this tab when switching templates.'
          : draftPersisted === 'pending'
            ? 'Edits are retained now; saving this tab’s copy…'
            : 'Current edits are in memory only: storage is unavailable or the draft is too large. Copy your code before reloading; an older disk copy may remain if storage cannot be cleared.'}
        {needsApply && ' The live UI still uses the last applied code. Initialize or run to apply edits.'}
      </p>
      {error && (
        <p className="repl-err" role="alert">
          {error}
        </p>
      )}
      <section className="guide-intro">
        <p className="kicker">INTERACTIVE WALKTHROUGH</p>
        <h2>{guide?.title ?? ex.title}</h2>
        <p>{guide?.purpose ?? ex.about}</p>
      </section>
      <div className="workbench-grid">
        <section className="lesson-live workbench-panel" aria-label="Interactive example">
          <h3>01 · Live interface</h3>
          <p className="workbench-feedback" role="status">
            {notice}
          </p>
          {scrubbed && (
            <p className="lnote">
              The UI and state tree remain live. Only the advanced debugger shows the selected historical snapshot.
            </p>
          )}
          <UiSlot
            element={session?.ui}
            placeholder={
              session
                ? 'This component needs later declarations; keep stepping.'
                : 'Start the example above. Your interactive demo will appear here.'
            }
          />
          <p className="lnote pane-about">
            <strong>Why this matters.</strong> <T>{ex.about}</T>
          </p>
          <details className="lesson-steps">
            <summary>Suggested steps</summary>
            <ol>
              {(
                guide?.steps ?? [
                  'Start the complete example.',
                  'Use its live controls and watch the result.',
                  'Read the explanation, then edit or step through the source.',
                ]
              ).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </details>
        </section>
        <section className="workbench-panel state-panel" aria-label="Live state">
          <h3>02 · State as data</h3>
          <LiveStateTree session={session} />
        </section>
        <section className="guide-source workbench-panel" aria-label="Editable code">
          <h3>03 · Editable code</h3>
          <p className="lnote">
            Edit the real model, demo actions and React component. Apply setup or run the demo to use your changes.
            Edited code runs with this site's browser privileges; review it before running.
          </p>
          <h3>Setup · model and named actions</h3>
          <CodeEditor
            value={setup}
            onChange={(value) => {
              setSetup(value);
            }}
            describe={describeName}
            values={trace}
            minHeight={100}
          />
          <h3>Prepared demo script · Run or Step</h3>
          <div className="source-editor">
            <CodeEditor
              value={source}
              onChange={(value) => {
                setSource(value);
              }}
              activeLine={at >= 0 ? frame?.step.line : 0}
              describe={describeName}
              values={trace}
              onLineClick={clickLine}
              minHeight={120}
            />
          </div>
          <h3>The React component (JSX)</h3>
          <CodeEditor value={uiSource} onChange={setUiSource} describe={jsxDescribe} values={trace} minHeight={200} />
          <pre data-export-only>{uiSource}</pre>
        </section>
      </div>
      <section className="manual-command" aria-label="Action templates">
        <h3>Try a change on the live state</h3>
        <p>
          Select a starting point, edit it, then explicitly run it. To read a value, use the data path in the state
          panel instead.
        </p>
        <div className="command-templates">
          {(ex.task === 'screen'
            ? ["toggle('a')", "setFilter('open')", 'completeBoth()']
            : ex.id === 'undo'
              ? ['setN(7)', "setLabel('My edit')", 'store.undo()', 'store.redo()']
              : ['// Call a named action defined in Setup']
          ).map((text) => (
            <button key={text} onClick={() => setCommand(text)}>
              {text}
            </button>
          ))}
        </div>
        <textarea
          aria-label="Manual command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          spellCheck={false}
        />
        <button disabled={!session || busy || !command.trim()} onClick={() => void runCommand()}>
          Run this command
        </button>
        {commandLines.length > 0 && (
          <div className="command-out" aria-live="polite">
            <OutputLines lines={commandLines} />
          </div>
        )}
      </section>
      <details className="guide-debug">
        <summary>Debug execution · logs, snapshots and step-by-step controls</summary>
        <p className="lnote">
          Optional developer tools. The live example above is the place to explore the feature; these are recorded
          execution details.
        </p>
        {ex.ui && session && (
          <details className="live-workbench">
            <summary>Live bindings, actions and change artefacts</summary>
            <ScopeWorkbench scope={session.scope} />
          </details>
        )}
        <div className="txbar" data-no-export>
          <button
            className="tab step-once"
            onClick={() => void execute('step')}
            disabled={busy || (!!session?.done && !needsApply)}
          >
            step
          </button>
          {frames.length > 0 && (
            <>
              <button
                className="tab"
                onClick={() => setAt(Math.max(0, cursor - 1))}
                disabled={cursor <= 0}
                title="previous recorded frame"
              >
                <SiteIcon name="chevron" className="icon-previous" />
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
                <SiteIcon name="chevron" className="icon-next" />
              </button>
              <span className="lnote">
                {cursor + 1}/{session?.steps.length} statements · {session?.done ? 'finished' : 'paused'}
                {frame ? ` · line ${frame.step.line}` : ''}
              </span>
            </>
          )}
        </div>
        <p className="lnote">
          Step executes one top-level statement; Run continues without debugger pauses. Scrubbing views recorded
          snapshots — it does not undo live objects. Timers and already-started asynchronous work are not frozen while
          paused.
        </p>
        <h3>output</h3>
        <div className="repl-out" aria-live="polite">
          {!shownLines.length && <span className="lnote">No output at this statement.</span>}
          <OutputLines lines={shownLines} />
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
      </details>
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
    <div className="wrap repl-page">
      <header className="page">
        <p className="kicker">STATE · INTERACTIVE EXAMPLES</p>
        <h1>UI, state and code.</h1>
        <p className="lead">
          Explore manually or run a demo. The interface, live values and editable code stay together.
        </p>
      </header>

      <nav className="quick-templates" aria-label="Starter templates">
        {[
          ['task-screen', 'React task screen'],
          ['undo', 'Undo & redo'],
          ['derived', 'Filtered collection'],
          ['lifecycle', 'Owned async work'],
        ].map(([id, label]) => (
          <a key={id} href={href(`/repl/${id}`)}>
            {label}
          </a>
        ))}
      </nav>
      <details className="repl-choose">
        <summary>Choose or compare examples</summary>
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
      </details>
      <div className={`repl-cols${other ? ' two' : ''}`}>
        <Pane key={ex.id} ex={ex} primary />
        {other && <Pane key={other.id} ex={other} primary={false} />}
      </div>

      <details className="repl-safety">
        <summary>What runs in this playground?</summary>
        <p>
          The ~{PROTO_LINES}-line prototype and comparison libraries execute locally in this tab. Edited code has this
          site's privileges; review it before running. Protocol simulations are not live servers.
        </p>
      </details>
      <footer>
        <T>Reading guide: R38, R80, R81.</T>
        Prototype source: <code>src/lib/proto.ts</code>. Examples: <code>src/data/examples.ts</code>. Step pauses after
        an actual top-level statement. Previous frames are immutable records, not reverse execution. The editor, parser
        and JSX transpiler are loaded on demand.
      </footer>
    </div>
  );
}
