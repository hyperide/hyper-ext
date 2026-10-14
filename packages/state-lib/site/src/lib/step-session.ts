import type { Step } from './instrument';
import { transpileJsx } from './jsx-sandbox';

export type OutputLine = { text: string; kind: 'log' | 'error' };
export type Frame = { step: Step; vars: Record<string, unknown>; logged: number };
export const safe = (value: unknown): string => {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(
        value,
        (_key, v) => {
          if (typeof v === 'function') return '[function]';
          if (typeof v === 'bigint') return `${v.toString()}n`;
          if (v && typeof v === 'object') {
            if (seen.has(v)) return '[circular]';
            seen.add(v);
          }
          return v;
        },
        2,
      ) ?? String(value)
    );
  } catch {
    return '[uninspectable]';
  }
};
export function hasMethod<K extends string>(
  value: unknown,
  key: K,
): value is { [P in K]: (...args: unknown[]) => unknown } {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof Reflect.get(value, key) === 'function'
  );
}
export function freezeAll(scope: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(scope).map(([key, value]) => {
      if (typeof value === 'function') return [key, '[function]']; // inspection must not pull a lazy derive
      const obj = value;
      const store = hasMethod(obj, 'snapshot') ? obj : undefined;
      const log: unknown = store ? Reflect.get(store, 'log') : undefined;
      const data =
        store && Array.isArray(log)
          ? { '⟨store⟩': store.snapshot(), log }
          : hasMethod(obj, 'inspect')
            ? obj.inspect()
            : hasMethod(obj, 'peek')
              ? { '⟨signal⟩': obj.peek() }
              : value;
      try {
        return [key, JSON.parse(safe(data))];
      } catch {
        return [key, String(data)];
      }
    }),
  );
}

/** The parser runs only when a reader starts a session. Real statements, not
 * newline guesses: semicolons, destructuring, regexes and TS all keep working. */
export async function compileSteps(setup: string, source: string) {
  const { parse } = await import('@babel/parser');
  const parseBody = (text: string) =>
    parse(text, { sourceType: 'module', allowAwaitOutsideFunction: true, plugins: ['typescript', 'jsx'] }).program.body;
  type Statement = ReturnType<typeof parse>['program']['body'][number];
  type Binding = Extract<Statement, { type: 'VariableDeclaration' }>['declarations'][number]['id'];
  type Property = Extract<Binding, { type: 'ObjectPattern' }>['properties'][number];
  type PropertyValue = Extract<Property, { type: 'ObjectProperty' }>['value'];
  const bindings = (node: Statement | Binding | PropertyValue | null | undefined): string[] => {
    if (!node) return [];
    if (node.type === 'Identifier') return [node.name];
    if (node.type === 'RestElement') return bindings(node.argument);
    if (node.type === 'AssignmentPattern') return bindings(node.left);
    if (node.type === 'ArrayPattern') return node.elements.flatMap(bindings);
    if (node.type === 'ObjectPattern')
      return node.properties.flatMap((p) => bindings(p.type === 'RestElement' ? p.argument : p.value));
    if (node.type === 'VariableDeclaration') return node.declarations.flatMap((d) => bindings(d.id));
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') return bindings(node.id);
    return [];
  };
  const setupNodes = parseBody(setup),
    nodes = parseBody(source);
  for (const n of [...setupNodes, ...nodes]) {
    if (n.type.startsWith('Import') || n.type.startsWith('Export'))
      throw new SyntaxError('Imports/exports are not available in this local REPL. Use the documented injected APIs.');
  }
  const seed = [...new Set(setupNodes.flatMap(bindings))];
  const names = [...seed];
  const steps: Step[] = [];
  const parts: string[] = [];
  let end = 0;
  const capture = (i: number) =>
    `\n{ const __replWait = __replCheckpoint(${i}, {${names.join(',')}}); if (__replWait) await __replWait; }\n`;
  const initial = capture(-1);
  nodes.forEach((node, i) => {
    parts.push(source.slice(end, node.end!));
    end = node.end!;
    for (const name of bindings(node)) if (!names.includes(name)) names.push(name);
    steps.push({ i, line: node.loc?.start.line ?? 1, text: source.slice(node.start!, node.end!), names: [...names] });
    parts.push(capture(i));
  });
  if ([...names].some((n) => n.startsWith('__repl') || n === '__scope'))
    throw new SyntaxError('__repl* and __scope are reserved debugger names.');
  return { initial, body: parts.join('') + source.slice(end), seed, names, steps };
}

type ApiFactory = (log: (...args: unknown[]) => void, cleanup: (fn: () => void) => void) => Record<string, unknown>;
export type StepSession = Awaited<ReturnType<typeof createStepSession>>;
/** An actual cooperative pause after a top-level statement. Run does not await
 * checkpoints: synchronous writes stay in one JS turn. Paused timers/network
 * callbacks remain live, just as in many debuggers; this is not virtual time. */
export async function createStepSession(setup: string, source: string, uiSource: string, makeApi: ApiFactory) {
  const compiled = await compileSteps(setup, source);
  const lines: OutputLine[] = [],
    frames: Frame[] = [];
  const listeners = new Set<() => void>(),
    cleanup = new Set<() => void>();
  let revision = 0,
    cancelled = false,
    finished = false,
    mode: 'paused' | 'running' = 'paused';
  let scope: Record<string, unknown> = {},
    ui: unknown = null;
  let gate: { resolve: () => void; reject: (e: Error) => void } | null = null;
  let waiters: (() => void)[] = [];
  let settleCancel: () => void = () => {};
  const cancellation = new Promise<void>((resolve) => {
    settleCancel = resolve;
  });
  const emit = () => {
    revision++;
    for (const fn of listeners) fn();
  };
  const changed = () => {
    emit();
    const waiting = waiters;
    waiters = [];
    waiting.forEach((f) => f());
  };
  const log = (...args: unknown[]) => {
    if (!cancelled) {
      lines.push({ kind: 'log', text: args.map((a) => (typeof a === 'string' ? a : safe(a))).join(' ') });
      emit();
    }
  };
  const api = makeApi(log, (fn) => cleanup.add(fn));
  let render: (scope: Record<string, unknown>) => unknown = () => null;
  const checkpoint = (i: number, values: Record<string, unknown>) => {
    if (cancelled) throw new Error('Session cancelled');
    scope = values;
    try {
      ui = render(scope);
    } catch {
      ui = null;
    } // a component may reference a later declaration (TDZ)
    if (i >= 0) frames.push({ step: compiled.steps[i], vars: freezeAll(scope), logged: lines.length });
    let pending: Promise<void> | undefined;
    if (mode === 'paused' && i < compiled.steps.length - 1)
      pending = new Promise<void>((resolve, reject) => {
        gate = { resolve, reject };
      });
    changed();
    return pending;
  };
  const transformed = await transpileJsx(
    `${setup}\n__replInstallUi((__scope) => {${uiSource}\n});\n${compiled.initial}\n${compiled.body}\nreturn {${compiled.names.join(',')}};`,
  );
  const names = Object.keys(api);
  const fn = new Function(...names, '__replCheckpoint', '__replInstallUi', `return (async()=>{${transformed}\n})()`);
  const completion = Promise.resolve(
    fn(...names.map((n) => api[n]), checkpoint, (value: typeof render) => {
      render = value;
    }),
  )
    .then((value) => {
      if (!cancelled) {
        scope = value;
        try {
          ui = render(scope);
        } catch (e) {
          ui = null;
          lines.push({ kind: 'error', text: `JSX: ${String(e)}` });
        }
      }
    })
    .catch((error) => {
      if (!cancelled) lines.push({ kind: 'error', text: String(error) });
    })
    .finally(() => {
      finished = true;
      gate = null;
      changed();
    });
  const release = () => {
    const pending = gate;
    gate = null;
    pending?.resolve();
  };
  return {
    lines,
    frames,
    steps: compiled.steps,
    get scope() {
      return scope;
    },
    get ui() {
      return ui;
    },
    get done() {
      return finished;
    },
    get running() {
      return mode === 'running' && !finished && !cancelled;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    version: () => revision,
    async step() {
      if (finished || cancelled) return;
      mode = 'paused';
      const until = new Promise<void>((resolve) => waiters.push(resolve));
      release();
      await Promise.race([until, cancellation]);
    },
    async run() {
      if (finished || cancelled) return;
      mode = 'running';
      release();
      await Promise.race([completion, cancellation]);
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      const pending = gate;
      gate = null;
      pending?.reject(new Error('Session cancelled'));
      settleCancel();
      changed();
      for (const dispose of cleanup) {
        try {
          dispose();
        } catch {}
      }
      cleanup.clear();
      listeners.clear();
    },
  };
}
