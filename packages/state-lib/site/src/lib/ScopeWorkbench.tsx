import { useEffect, useReducer, useState } from 'react';
import { hasMethod, safe } from './step-session';

/** REPL helper, not a state-lib API. Every example gets usable controls even
 * when its subject is a mechanism rather than a specific product screen. */
export function ScopeWorkbench({ scope }: { scope: Record<string, unknown> }) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [args, setArgs] = useState('[]'),
    [result, setResult] = useState('');
  useEffect(() => {
    const off: (() => void)[] = [];
    for (const item of Object.values(scope)) {
      if (hasMethod(item, 'onCommit')) {
        const dispose = item.onCommit(refresh);
        if (typeof dispose === 'function') off.push(() => dispose());
      } else if (hasMethod(item, 'subscribe')) {
        try {
          const dispose = item.subscribe(refresh);
          if (typeof dispose === 'function') off.push(() => dispose());
        } catch {}
      }
    }
    return () => off.forEach((fn) => fn());
  }, [scope]);
  const invoke = async (fn: Function) => {
    try {
      const a = JSON.parse(args);
      if (!Array.isArray(a)) throw new Error('Arguments must be a JSON array');
      setResult(safe(await fn(...a)));
      refresh();
    } catch (e) {
      setResult(String(e));
    }
  };
  const primitives = Object.entries(scope).flatMap(([name, value]) =>
    hasMethod(value, 'set') && hasMethod(value, 'peek') ? [[name, value] as const] : [],
  );
  const functions = Object.entries(scope).filter(([name, v]) => typeof v === 'function' && !name.startsWith('__'));
  const stores = Object.entries(scope).flatMap(([name, value]) =>
    hasMethod(value, 'snapshot') && hasMethod(value, 'action') ? [[name, value] as const] : [],
  );
  return (
    <div className="scope-workbench">
      <p className="lnote">
        Live controls · these change the same objects used by the code. Earlier debugger frames stay frozen.
      </p>
      {primitives.map(([name, item]) => (
        <label className="workbench-field" key={name}>
          {name}
          <input
            aria-label={`Set signal ${name}`}
            defaultValue={safe(item.peek())}
            onBlur={(e) => {
              try {
                item.set(JSON.parse(e.target.value));
                setResult(`Updated ${name}`);
                refresh();
              } catch (err) {
                setResult(String(err));
              }
            }}
          />
        </label>
      ))}
      {stores.map(([name, item]) => {
        const store = item;
        const logValue: unknown = Reflect.get(store, 'log');
        const log = Array.isArray(logValue) ? logValue : [];
        const last: unknown = log.at(-1);
        const change = last && typeof last === 'object' ? last : {};
        return (
          <div key={name}>
            <strong>{name}</strong>
            <div className="workbench-actions">
              <button
                className="tab"
                onClick={() => {
                  if (hasMethod(store, 'undo')) store.undo();
                  refresh();
                }}
              >
                Undo
              </button>
              <button
                className="tab"
                onClick={() => {
                  if (hasMethod(store, 'redo')) store.redo();
                  refresh();
                }}
              >
                Redo
              </button>
            </div>
            <pre>{safe(store.snapshot())}</pre>
            {log.length > 0 && (
              <div className="artefact-grid">
                <section>
                  <b>1 · Snapshot</b>
                  <pre>{safe(store.snapshot())}</pre>
                </section>
                <section>
                  <b>2 · Change record: patch + inverse</b>
                  <pre>
                    {safe({
                      patches: 'patches' in change ? change.patches : undefined,
                      inverse: 'inverse' in change ? change.inverse : undefined,
                    })}
                  </pre>
                </section>
                <section>
                  <b>3 · Intent: named command</b>
                  <pre>{safe('name' in change ? change.name : undefined)}</pre>
                </section>
              </div>
            )}
          </div>
        );
      })}
      {functions.length > 0 && (
        <>
          <label className="workbench-field">
            Action arguments (JSON array)
            <input value={args} onChange={(e) => setArgs(e.target.value)} aria-label="Action arguments" />
          </label>
          <div className="workbench-actions">
            {functions.map(([name, fn]) => (
              <button key={name} className="tab" onClick={() => void invoke(fn as Function)}>
                {name}()
              </button>
            ))}
          </div>
        </>
      )}
      <details>
        <summary>Inspect all live bindings</summary>
        <pre>{safe(scope)}</pre>
      </details>
      <output className="workbench-result" aria-live="polite">
        {result}
      </output>
    </div>
  );
}
export const DEFAULT_UI =
  '// ScopeWorkbench is a REPL helper, not an export of state-lib.\n// __scope contains the live top-level variables in this example.\nreturn <ScopeWorkbench scope={__scope} />';
