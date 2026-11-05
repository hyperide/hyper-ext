import { timingRelation } from './example-lab/core';
import '../example-lab.css';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { LAB_EXAMPLES } from '../data/example-lab/catalogue';
import { compileProject, loadProject, previewProject, runBenchmark, submitMeasurement } from './example-lab/client';
import {
  VARIANT_LABELS,
  type BenchmarkResult,
  type BuildArtifact,
  type ExampleBuild,
  type ExampleMetadata,
  type ExampleProject,
  type Mechanism,
  type OperationId,
  type PreviewAction,
  type PreviewState,
  type RunSettings,
  type VariantId,
} from './example-lab/types';
import { bestIndices } from './benchmark-best';
import { highlight } from './highlight';
import { LazyEditor } from './LazyEditor';
import { href } from './router';

/**
 * The example workbench: one surface holding an example's source, its live
 * board, the compiled output with real byte counts, and measured timings.
 *
 * Nothing runs on arrival except loading the project. Compiling and measuring
 * are explicit clicks, and each keeps its last valid result when a later
 * attempt fails, so a typo in the source never wipes what was measured before.
 * Every async operation owns an AbortController that is aborted on unmount, on
 * restart and on Cancel; an aborted call is never shown as an error.
 *
 * Kept in one file on purpose (the file scope was fixed): small hooks own the
 * async work, small components own the panels, `ExampleLab` only composes.
 */

/* ---------- small shared helpers ---------- */

export const BENCH_COUNTS = [1, 30, 300, 1200, 10000] as const;
export const BENCH_SAMPLES = [5, 9] as const;
const OPERATION_LABELS: Record<OperationId, string> = {
  point: 'Point edit',
  dense: 'Dense edit',
  sparse: 'Sparse edit',
  move: 'Move',
  history: 'History',
};
const SIZE_TERMS = ['rawbytes', 'gzipbytes', 'source', 'generated', 'size', 'bytes', 'gzip', 'bundle', 'compile'];
const TIME_TERMS = ['time', 'timing', 'speed', 'runtime', 'median'];
const BOARD_ROWS_PER_COLUMN = 6;
const MAX_ACTIONS = 200;
const CODE_HIGHLIGHT_LIMIT = 24_000;
const DEFAULT_SETTINGS: RunSettings = {
  count: 300,
  operation: 'point',
  samples: 5,
  historyLimit: 40,
  includeSetup: false,
};

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const fmtMs = (ms: number) => (ms < 0.01 ? ms.toFixed(5) : ms < 1 ? ms.toFixed(3) : ms.toFixed(1));
const fmtBytes = (n: number) => `${n.toLocaleString('en-US')} B`;
const fmtDelta = (n: number) => (n === 0 ? '±0 B' : `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US')} B`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Mechanism hrefs are `/spec#anchor`; the router mode decides how that is written. */
function mechanismHref(target: string): string {
  if (!target.startsWith('/')) return target;
  const [route, anchor] = target.split('#');
  return href(route, anchor);
}
function sourceOriginHref(origin: string): string | null {
  return /^https?:\/\//.test(origin) ? origin : null;
}
export function pickMechanisms(mechanisms: Mechanism[], terms: string[]): Mechanism[] {
  const wanted = new Set(terms.map((t) => t.toLowerCase()));
  const matching = mechanisms.filter((m) => m.affects.some((a) => wanted.has(a.toLowerCase())));
  return matching.length ? matching : mechanisms;
}

/* ---------- session storage (edits and the last measured result) ---------- */

const editsKey = (id: string) => `example-lab:edits:${id}`;
const resultKey = (id: string) => `example-lab:result:${id}`;

function readStored(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}
function writeStored(key: string, value: unknown | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage full or unavailable: the in-memory state still works. */
  }
}
function readEdits(id: string): Record<string, string> {
  const raw = readStored(editsKey(id));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}
function isBenchmarkResult(value: unknown): value is BenchmarkResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<BenchmarkResult>;
  return v.version === 1 && typeof v.exampleId === 'string' && Array.isArray(v.rows) && !!v.settings;
}
/** The last result measured in this tab, or null. Bench uses it for its overview. */
export function readLastResult(id: string): BenchmarkResult | null {
  const raw = readStored(resultKey(id));
  return isBenchmarkResult(raw) && raw.exampleId === id ? raw : null;
}

/* ---------- async hooks ---------- */

/** One cancellable job slot: starting a new job aborts the previous one; unmount aborts it. */
function useJobSlot() {
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  const start = useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    return controller;
  }, []);
  const cancel = useCallback(() => current.current?.abort(), []);
  const owns = useCallback((controller: AbortController) => current.current === controller, []);
  // Stable identity: hooks put the slot in dependency lists, and a fresh object per render would loop them.
  return useMemo(() => ({ start, cancel, owns }), [start, cancel, owns]);
}

/** True when a failure is a real error rather than the result of our own abort. */
const isRealFailure = (controller: AbortController, failure: unknown) =>
  !controller.signal.aborted && !isAbort(failure);

function useProject(id: string) {
  const [project, setProject] = useState<ExampleProject | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setProject(null);
    setError('');
    loadProject(id, controller.signal).then(
      (loaded) => {
        if (!controller.signal.aborted) setProject(loaded);
      },
      (failure: unknown) => {
        if (!controller.signal.aborted && !isAbort(failure)) setError(messageOf(failure));
      },
    );
    return () => controller.abort();
  }, [id, attempt]);
  return { project, error, retry: () => setAttempt((n) => n + 1) };
}

function useEdits(project: ExampleProject) {
  const [stored, setStored] = useState(() => readEdits(project.id));
  const edits = Object.fromEntries(
    Object.entries(stored).filter(([file, text]) => project.editable.includes(file) && text !== project.files[file]),
  );
  const serialized = JSON.stringify(edits);
  useEffect(() => {
    writeStored(editsKey(project.id), serialized === '{}' ? null : (JSON.parse(serialized) as unknown));
  }, [project.id, serialized]);
  const setFile = (file: string, text: string) => setStored((prev) => ({ ...prev, [file]: text }));
  const resetFile = (file: string) =>
    setStored((prev) => Object.fromEntries(Object.entries(prev).filter(([name]) => name !== file)));
  return { edits, setFile, resetFile };
}

interface BuildPair {
  current: ExampleBuild | null;
  /** The last build with different source — what the size deltas compare against. */
  previous: ExampleBuild | null;
  /** The edits the current build was compiled from, to tell when the editor has moved on. */
  compiledFrom: string;
}

function useCompile(project: ExampleProject, edits: Record<string, string>) {
  const job = useJobSlot();
  const [pair, setPair] = useState<BuildPair>({ current: null, previous: null, compiledFrom: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const compile = async () => {
    const controller = job.start();
    const signature = JSON.stringify(edits);
    setBusy(true);
    setError('');
    try {
      const next = await compileProject(project, edits, controller.signal);
      if (!job.owns(controller) || controller.signal.aborted) return;
      setPair(({ current, previous }) => ({
        current: next,
        previous: current && current.sourceHash !== next.sourceHash ? current : previous,
        compiledFrom: signature,
      }));
    } catch (failure) {
      if (job.owns(controller) && isRealFailure(controller, failure)) setError(messageOf(failure));
    } finally {
      if (job.owns(controller)) setBusy(false);
    }
  };
  const dirty = pair.current !== null && pair.compiledFrom !== JSON.stringify(edits);
  return { ...pair, error, busy, dirty, compile, cancel: job.cancel };
}

function useBenchmark(project: ExampleProject, build: ExampleBuild | null, settings: RunSettings) {
  const job = useJobSlot();
  const [result, setResult] = useState<BenchmarkResult | null>(() => readLastResult(project.id));
  const [progress, setProgress] = useState<{ label: string; fraction: number | null } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!build) return;
    const controller = job.start();
    setBusy(true);
    setError('');
    setProgress(null);
    try {
      const next = await runBenchmark(
        build,
        settings,
        (update: unknown) => {
          if (job.owns(controller)) setProgress(readProgress(update));
        },
        controller.signal,
      );
      if (!job.owns(controller) || controller.signal.aborted) return;
      setResult(next);
      writeStored(resultKey(project.id), next);
    } catch (failure) {
      if (job.owns(controller) && isRealFailure(controller, failure)) setError(messageOf(failure));
    } finally {
      if (job.owns(controller)) {
        setBusy(false);
        setProgress(null);
      }
    }
  };
  return { result, progress, error, busy, run, cancel: job.cancel };
}

/** The progress payload is not typed by the client; accept a fraction or completed/total. */
function readProgress(update: unknown): { label: string; fraction: number | null } | null {
  if (typeof update === 'string') return { label: update, fraction: null };
  if (typeof update === 'number' && Number.isFinite(update)) {
    const fraction = update > 1 ? Math.min(update / 100, 1) : Math.max(update, 0);
    return { label: `${Math.round(fraction * 100)}%`, fraction };
  }
  if (!update || typeof update !== 'object') return null;
  const { completed, total, label } = update as { completed?: unknown; total?: unknown; label?: unknown };
  if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
    return { label: `${completed} of ${total}`, fraction: Math.min(completed / total, 1) };
  }
  return typeof label === 'string' ? { label, fraction: null } : null;
}

function usePreview(build: ExampleBuild | null, settings: RunSettings) {
  const job = useJobSlot();
  const [actions, setActions] = useState<PreviewAction[]>([]);
  const [state, setState] = useState<PreviewState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The board follows the build and the size settings only; run controls like `operation` must not reset it.
  const latest = useRef(settings);
  latest.current = settings;
  const { count, historyLimit } = settings;
  const request = useCallback(
    async (next: PreviewAction[]) => {
      if (!build) return;
      const controller = job.start();
      setBusy(true);
      setError('');
      try {
        const sized: RunSettings = { ...latest.current, count, historyLimit };
        const board = await previewProject(build, sized, next, controller.signal);
        if (!job.owns(controller) || controller.signal.aborted) return;
        setState(board);
        setActions(next);
      } catch (failure) {
        if (job.owns(controller) && isRealFailure(controller, failure)) setError(messageOf(failure));
      } finally {
        if (job.owns(controller)) setBusy(false);
      }
    },
    [build, count, historyLimit, job],
  );
  useEffect(() => {
    void request([]);
  }, [request]);
  const apply = (action: PreviewAction) => {
    // Dropping the oldest action would replay to a different board, so a full history stops instead.
    if (actions.length >= MAX_ACTIONS) return setError('The action history is full. Compile again to start over.');
    void request([...actions, action]);
  };
  return { actions, state, error, busy, apply };
}

type ShareStatus = 'idle' | 'sending' | 'stored' | 'duplicate' | 'failed';
function useShare(result: BenchmarkResult | null) {
  const [status, setStatus] = useState<ShareStatus>('idle');
  const [error, setError] = useState('');
  const key = result?.createdAt;
  useEffect(() => {
    setStatus('idle');
    setError('');
  }, [key]);
  const share = async () => {
    if (!result) return;
    setStatus('sending');
    setError('');
    try {
      const outcome = await submitMeasurement(result);
      setStatus(outcome.duplicate ? 'duplicate' : outcome.stored ? 'stored' : 'failed');
    } catch (failure) {
      setStatus('failed');
      setError(messageOf(failure));
    }
  };
  return { status, error, share };
}

/* ---------- presentational pieces ---------- */

function CodeBlock({ code, label }: { code: string; label: string }) {
  const html = useMemo(() => (code.length <= CODE_HIGHLIGHT_LIMIT ? highlight(code) : null), [code]);
  return (
    <pre className="xl-code" tabIndex={0} aria-label={label}>
      {html === null ? <code>{code}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}
    </pre>
  );
}

function Panel({ area, title, children }: { area: string; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={`xl-panel xl-${area}`} aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

function ErrorLine({ text }: { text: string }) {
  return text ? (
    <p className="xl-error" role="alert">
      {text}
    </p>
  ) : null;
}

function MechanismLinks({ mechanisms, label }: { mechanisms: Mechanism[]; label: string }) {
  if (!mechanisms.length) return null;
  return (
    <ul className="xl-mechanisms" aria-label={label}>
      {mechanisms.map((m) => (
        <li key={m.id}>
          <a href={mechanismHref(m.href)} data-mechanism-href={m.href}>
            {m.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

function SourceLine({ project }: { project: ExampleMetadata & { sourceRevision: string } }) {
  const link = sourceOriginHref(project.origin);
  return (
    <p className="xl-origin">
      Source:{' '}
      {link ? (
        <a href={link} rel="noreferrer">
          View original source
        </a>
      ) : (
        <code>{project.origin}</code>
      )}{' '}
      · revision <code>{project.sourceRevision.slice(0, 12)}</code>
    </p>
  );
}

/* ---------- source panel ---------- */

interface SourceProps {
  project: ExampleProject;
  edits: Record<string, string>;
  file: string;
  onFile: (file: string) => void;
  onEdit: (file: string, text: string) => void;
  onReset: (file: string) => void;
  compile: ReturnType<typeof useCompile>;
}

function FileTabs({ project, edits, file, onFile }: Pick<SourceProps, 'project' | 'edits' | 'file' | 'onFile'>) {
  return (
    <div className="xl-files" role="tablist" aria-label="Project files">
      {[
        project.defaultFile,
        ...project.editable.filter((name) => name !== project.defaultFile),
        ...Object.keys(project.files).filter((name) => !project.editable.includes(name)),
      ].map((name) => {
        const editable = project.editable.includes(name);
        return (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={name === file}
            className={`xl-file${name === file ? ' on' : ''}`}
            onClick={() => onFile(name)}
          >
            {name}
            {name in edits && <span className="xl-file-mark"> · edited</span>}
            {!editable && <span className="xl-file-mark"> · library</span>}
          </button>
        );
      })}
    </div>
  );
}

function SourcePanel(props: SourceProps) {
  const { project, edits, file, onEdit, onReset, compile } = props;
  const editable = project.editable.includes(file);
  const text = edits[file] ?? project.files[file] ?? '';
  return (
    <Panel area="source" title="Source">
      <FileTabs {...props} />
      {editable ? (
        <div className="xl-editor" data-editable="true">
          <LazyEditor value={text} onChange={(value) => onEdit(file, value)} minHeight={300} />
        </div>
      ) : (
        <CodeBlock code={text} label={`${file} (read-only)`} />
      )}
      <div className="xl-actions">
        <button
          type="button"
          className="tab runall xl-compile"
          disabled={compile.busy}
          onClick={() => void compile.compile()}
        >
          {compile.busy ? 'Compiling…' : compile.current ? 'Compile again' : 'Compile'}
        </button>
        {compile.busy && (
          <button type="button" className="tab xl-cancel-compile" onClick={compile.cancel}>
            Cancel
          </button>
        )}
        {file in edits && (
          <button type="button" className="tab" onClick={() => onReset(file)}>
            Restore original
          </button>
        )}
        {compile.dirty && <span className="xl-note">Edits are not compiled yet.</span>}
      </div>
      <ErrorLine text={compile.error} />
      <SourceLine project={project} />
    </Panel>
  );
}

/* ---------- compiled output ---------- */

function sizeRows(build: ExampleBuild, previous: ExampleBuild | null) {
  return (Object.keys(VARIANT_LABELS) as VariantId[]).map((variant) => {
    const now = build.artifacts[variant];
    const before = previous?.artifacts[variant];
    return {
      variant,
      raw: now.rawBytes,
      gzip: now.gzipBytes,
      rawDelta: before ? now.rawBytes - before.rawBytes : null,
      gzipDelta: before ? now.gzipBytes - before.gzipBytes : null,
      inputs: now.inputs,
      added: before ? now.inputs.filter((i) => !before.inputs.includes(i)) : [],
      removed: before ? before.inputs.filter((i) => !now.inputs.includes(i)) : [],
    };
  });
}

function SizeTable({ build, previous }: { build: ExampleBuild; previous: ExampleBuild | null }) {
  const rows = sizeRows(build, previous);
  const max = Math.max(...rows.map((r) => r.raw), 1);
  const bestRaw = bestIndices(rows.map((r) => r.raw));
  const bestGzip = bestIndices(rows.map((r) => r.gzip));
  return (
    <div className="xl-sizes">
      <table>
        <caption>Bundle size, including everything each variant imports</caption>
        <thead>
          <tr>
            <th scope="col">Variant</th>
            <th scope="col">Minified</th>
            <th scope="col">Gzip</th>
            {previous && <th scope="col">Since last compile</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.variant} data-variant={r.variant}>
              <th scope="row">{VARIANT_LABELS[r.variant]}</th>
              <td className={bestRaw.includes(i) ? 'xl-best' : undefined} data-best={bestRaw.includes(i) || undefined}>
                {fmtBytes(r.raw)}
              </td>
              <td
                className={bestGzip.includes(i) ? 'xl-best' : undefined}
                data-best={bestGzip.includes(i) || undefined}
              >
                {fmtBytes(r.gzip)}
              </td>
              {previous && (
                <td>
                  {r.rawDelta === null ? '—' : `${fmtDelta(r.rawDelta)} · gzip ${fmtDelta(r.gzipDelta ?? 0)}`}
                  {(r.added.length > 0 || r.removed.length > 0) && (
                    <span className="xl-imports">
                      {r.added.map((f) => ` +${f}`)}
                      {r.removed.map((f) => ` −${f}`)}
                    </span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="benchbars" aria-hidden="true">
        {rows.map((r) => (
          <div className="bb" key={r.variant}>
            <span className="bb-name">{VARIANT_LABELS[r.variant]}</span>
            <span className="bb-bar">
              <span data-bytes={r.raw} style={{ width: `${Math.max(2, (r.raw / max) * 100)}%` }} />
            </span>
            <span className="bb-ms">{fmtBytes(r.raw)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type OutputView = { kind: 'bundle'; form: 'readable' | 'minified' } | { kind: 'generated'; file: string };

function viewValue(view: OutputView) {
  return view.kind === 'bundle' ? `bundle:${view.form}` : `generated:${view.file}`;
}
function parseView(value: string): OutputView {
  if (value.startsWith('generated:')) return { kind: 'generated', file: value.slice('generated:'.length) };
  return { kind: 'bundle', form: value === 'bundle:minified' ? 'minified' : 'readable' };
}
function viewCode(build: ExampleBuild, variant: VariantId, view: OutputView): string {
  if (view.kind === 'generated') return build.generatedFiles[view.file] ?? '';
  const artifact: BuildArtifact = build.artifacts[variant];
  return view.form === 'readable' ? artifact.readableCode : artifact.code;
}

function OutputViewer({ build }: { build: ExampleBuild }) {
  const [variant, setVariant] = useState<VariantId>('compiled');
  const [view, setView] = useState<OutputView>(() =>
    Object.keys(build.generatedFiles)[0]
      ? { kind: 'generated', file: Object.keys(build.generatedFiles)[0] }
      : { kind: 'bundle', form: 'readable' },
  );
  const generated = Object.keys(build.generatedFiles);
  const shown =
    view.kind === 'generated' && !generated.includes(view.file)
      ? ({ kind: 'bundle', form: 'readable' } as const)
      : view;
  return (
    <div className="xl-viewer">
      <div className="xl-view-controls">
        <label>
          <span>Show</span>
          <select aria-label="Show" value={viewValue(shown)} onChange={(e) => setView(parseView(e.target.value))}>
            <option value="bundle:readable">Full bundle, readable</option>
            <option value="bundle:minified">Full bundle, minified</option>
            {generated.map((file) => (
              <option key={file} value={`generated:${file}`}>
                Generated source: {file}
              </option>
            ))}
          </select>
        </label>
        {shown.kind === 'bundle' && (
          <div className="xl-segment" role="group" aria-label="Variant">
            {(Object.keys(VARIANT_LABELS) as VariantId[]).map((v) => (
              <button key={v} type="button" aria-pressed={variant === v} onClick={() => setVariant(v)}>
                {VARIANT_LABELS[v]}
              </button>
            ))}
          </div>
        )}
      </div>
      <CodeBlock code={viewCode(build, variant, shown)} label="Compiled output" />
    </div>
  );
}

function OutputPanel({
  project,
  build,
  previous,
}: {
  project: ExampleProject;
  build: ExampleBuild | null;
  previous: ExampleBuild | null;
}) {
  return (
    <Panel area="output" title="Compiled output">
      {build ? (
        <>
          <SizeTable build={build} previous={previous} />
          <MechanismLinks mechanisms={pickMechanisms(project.mechanisms, SIZE_TERMS)} label="How the size changes" />
          <OutputViewer build={build} />
          <p className="xl-note">Compiled in {fmtMs(build.compileMs)} ms.</p>
        </>
      ) : (
        <div className="xl-empty">
          <p>
            Compile to see both variants side by side: real byte counts, every imported file, and the generated source.
          </p>
          <MechanismLinks mechanisms={project.mechanisms} label="What the compiler changes" />
        </div>
      )}
    </Panel>
  );
}

/* ---------- live board ---------- */

function describeAction(action: PreviewAction, n: number): string {
  if (action.operation === 'undo' || action.operation === 'redo') return `${n}. ${action.operation}`;
  const target = action.index === undefined ? '' : ` row ${action.index + 1}`;
  const text = action.text ? ` “${action.text}”` : '';
  return `${n}. ${OPERATION_LABELS[action.operation].toLowerCase()}${target}${text}`;
}

function BoardColumns({
  board,
  selected,
  onSelect,
}: {
  board: PreviewState;
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="xl-columns">
      {board.columns.map((column) => {
        const shown = column.items.slice(0, BOARD_ROWS_PER_COLUMN);
        return (
          <section className="xl-column" key={column.id} aria-label={column.title}>
            <h4>
              {column.title} <span>{column.count.toLocaleString('en-US')}</span>
            </h4>
            <ul>
              {shown.map((row) => (
                <li key={row.id} className={row.done ? 'done' : undefined}>
                  <button type="button" aria-pressed={selected === row.index} onClick={() => onSelect(row.index)}>
                    <span aria-hidden="true">{row.done ? '✓' : '○'}</span> {row.text}
                  </button>
                </li>
              ))}
            </ul>
            {column.count > shown.length && (
              <p className="xl-more">+{(column.count - shown.length).toLocaleString('en-US')} more</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function BoardControls({
  project,
  board,
  busy,
  selected,
  onApply,
}: {
  project: ExampleProject;
  board: PreviewState;
  busy: boolean;
  selected: number;
  onApply: (a: PreviewAction) => void;
}) {
  const changes = project.operations.filter((op) => op !== 'history');
  const [operation, setOperation] = useState<OperationId>(changes[0] ?? 'point');
  const [text, setText] = useState('');
  return (
    <div className="xl-board-controls">
      <label>
        <span>Change</span>
        <select aria-label="Change" value={operation} onChange={(e) => setOperation(e.target.value as OperationId)}>
          {changes.map((op) => (
            <option key={op} value={op}>
              {OPERATION_LABELS[op]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Text</span>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={80} />
      </label>
      <div className="xl-actions">
        <button
          type="button"
          className="tab xl-apply"
          disabled={busy}
          onClick={() => onApply({ operation, text: text || undefined, index: selected })}
        >
          Apply
        </button>
        <button
          type="button"
          className="tab xl-undo"
          disabled={busy || !board.canUndo}
          onClick={() => onApply({ operation: 'undo' })}
        >
          Undo
        </button>
        <button
          type="button"
          className="tab xl-redo"
          disabled={busy || !board.canRedo}
          onClick={() => onApply({ operation: 'redo' })}
        >
          Redo
        </button>
      </div>
    </div>
  );
}

function BoardPanel({
  project,
  build,
  settings,
}: {
  project: ExampleProject;
  build: ExampleBuild | null;
  settings: RunSettings;
}) {
  const preview = usePreview(build, settings);
  const [selected, setSelected] = useState(0);
  return (
    <Panel area="board" title="Live board">
      {preview.state ? (
        <>
          <p className="xl-board-title">
            <b>{preview.state.title}</b> · {plural(preview.state.total, 'task')}
            {preview.busy && <span className="xl-note"> · updating…</span>}
          </p>
          <BoardColumns board={preview.state} selected={selected} onSelect={setSelected} />
          <BoardControls
            project={project}
            board={preview.state}
            busy={preview.busy}
            selected={selected}
            onApply={preview.apply}
          />
          {preview.actions.length > 0 && (
            <ol className="xl-history" aria-label="Action history">
              {preview.actions.slice(-5).map((a, i, all) => (
                <li key={preview.actions.length - all.length + i}>
                  {describeAction(a, preview.actions.length - all.length + i + 1)}
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <div className="xl-empty">
          <p>
            {build
              ? 'Loading the board…'
              : `${project.summary} Compile the source to fill the board with tasks you can edit, move, undo and redo.`}
          </p>
        </div>
      )}
      <ErrorLine text={preview.error} />
    </Panel>
  );
}

/* ---------- benchmark controls and results ---------- */

function SettingsForm({
  project,
  settings,
  onChange,
}: {
  project: ExampleProject;
  settings: RunSettings;
  onChange: (s: RunSettings) => void;
}) {
  const set = <K extends keyof RunSettings>(key: K, value: RunSettings[K]) => onChange({ ...settings, [key]: value });
  return (
    <div className="xl-settings">
      <label>
        <span>Tasks</span>
        <select aria-label="Tasks" value={settings.count} onChange={(e) => set('count', Number(e.target.value))}>
          {BENCH_COUNTS.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString('en-US')}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Operation</span>
        <select
          aria-label="Operation"
          value={settings.operation}
          onChange={(e) => set('operation', e.target.value as OperationId)}
        >
          {project.operations.map((op) => (
            <option key={op} value={op}>
              {OPERATION_LABELS[op]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Samples</span>
        <select aria-label="Samples" value={settings.samples} onChange={(e) => set('samples', Number(e.target.value))}>
          {BENCH_SAMPLES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>History limit</span>
        <input
          type="number"
          min={1}
          max={1000}
          value={settings.historyLimit}
          onChange={(e) => set('historyLimit', Math.max(1, Math.min(1000, Number(e.target.value) || 40)))}
        />
      </label>
      <label className="xl-check">
        <input
          type="checkbox"
          checked={settings.includeSetup}
          onChange={(e) => set('includeSetup', e.target.checked)}
        />
        <span>Include setup in the timing</span>
      </label>
    </div>
  );
}

function TimingBars({
  result,
  selected,
  onSelect,
}: {
  result: BenchmarkResult;
  selected: VariantId;
  onSelect: (v: VariantId) => void;
}) {
  const max = Math.max(...result.rows.map((r) => r.medianMs), Number.MIN_VALUE);
  const best = bestIndices(result.rows.map((r) => r.medianMs));
  return (
    <div className="benchbars xl-timing">
      {result.rows.map((row, i) => (
        <button
          key={row.variant}
          type="button"
          className={`bb xl-bar${best.includes(i) ? ' xl-best' : ''}`}
          aria-pressed={selected === row.variant}
          data-variant={row.variant}
          data-median={row.medianMs}
          onClick={() => onSelect(row.variant)}
        >
          <span className="bb-name">{VARIANT_LABELS[row.variant]}</span>
          <span className="bb-bar">
            <span style={{ width: `${Math.max(2, (row.medianMs / max) * 100)}%` }} />
          </span>
          <span className="bb-ms">{fmtMs(row.medianMs)} ms</span>
        </button>
      ))}
    </div>
  );
}

function TimingTable({ result }: { result: BenchmarkResult }) {
  const median = bestIndices(result.rows.map((r) => r.medianMs));
  const p95 = bestIndices(result.rows.map((r) => r.p95Ms));
  return (
    <table className="xl-results">
      <thead>
        <tr>
          <th scope="col">Variant</th>
          <th scope="col">Median</th>
          <th scope="col">P95 batch mean</th>
          <th scope="col">Runs per sample</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => (
          <tr key={row.variant} data-variant={row.variant}>
            <th scope="row">{VARIANT_LABELS[row.variant]}</th>
            <td className={median.includes(i) ? 'xl-best' : undefined} data-best={median.includes(i) || undefined}>
              {fmtMs(row.medianMs)} ms
            </td>
            <td className={p95.includes(i) ? 'xl-best' : undefined} data-best={p95.includes(i) || undefined}>
              {fmtMs(row.p95Ms)} ms
            </td>
            <td>{row.iterations.toLocaleString('en-US')}</td>
            <td>{fmtMs(row.totalMs)} ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function verdictOf(result: BenchmarkResult): string {
  if (!result.equivalent)
    return 'The validation sequence produced different states. Compare the implementations before using this timing result.';
  const [a, b] = result.rows;
  if (!a || !b) return 'Run both implementations to compare their timings.';
  if (timingRelation(a.medianMs, b.medianMs) === 'timer-floor') return 'Increase the workload to resolve this timing.';
  if (timingRelation(a.medianMs, b.medianMs) === 'tie')
    return 'The same command sequence produces identical state. Median times are tied.';
  const fast = a.medianMs < b.medianMs ? a : b;
  const slow = fast === a ? b : a;
  return `The same command sequence produces identical state. ${VARIANT_LABELS[fast.variant]} was ${(slow.medianMs / fast.medianMs).toFixed(1)}× faster at the median.`;
}

function SampleSpread({ result, selected }: { result: BenchmarkResult; selected: VariantId }) {
  const all = result.rows.flatMap((r) => r.samplesMs);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const at = (ms: number) => (hi === lo ? 50 : ((ms - lo) / (hi - lo)) * 100);
  return (
    <div className="xl-spread">
      {result.rows.map((row) => (
        <div
          key={row.variant}
          className={`xl-spread-row${row.variant === selected ? ' on' : ''}`}
          data-variant={row.variant}
        >
          <span>{VARIANT_LABELS[row.variant]}</span>
          <span
            className="xl-axis"
            role="img"
            aria-label={`${row.samplesMs.length} samples from ${fmtMs(Math.min(...row.samplesMs))} to ${fmtMs(Math.max(...row.samplesMs))} ms`}
          >
            {row.samplesMs.map((ms, i) => (
              <i key={i} className="xl-dot" style={{ left: `${at(ms)}%` }} />
            ))}
          </span>
          <span className="xl-samples">{row.samplesMs.map(fmtMs).join(' · ')} ms</span>
        </div>
      ))}
      <p className="xl-note">
        Axis: {fmtMs(lo)} – {fmtMs(hi)} ms
      </p>
    </div>
  );
}

function ResultDetails({ result, selected }: { result: BenchmarkResult; selected: VariantId }) {
  const s = result.settings;
  return (
    <details className="xl-details">
      <summary>Details</summary>
      <SampleSpread result={result} selected={selected} />
      <dl>
        <dt>Conditions</dt>
        <dd>
          {plural(s.count, 'task')} · {OPERATION_LABELS[s.operation].toLowerCase()} · {plural(s.samples, 'sample')} ·
          history limit {s.historyLimit} · setup {s.includeSetup ? 'included' : 'excluded'}
        </dd>
        <dt>Result checksums</dt>
        <dd>{result.rows.map((r) => `${VARIANT_LABELS[r.variant]} ${r.checksum}`).join(' · ')}</dd>
        <dt>Environment</dt>
        <dd>
          {result.environment.engine} {result.environment.engineVersion} · {result.environment.platform} · timer
          resolution {result.environment.timerResolutionMs} ms
        </dd>
        <dt>Source</dt>
        <dd>
          <code>{result.sourceRevision.slice(0, 12)}</code> · build <code>{result.sourceHash.slice(0, 12)}</code> ·{' '}
          {new Date(result.createdAt).toLocaleString('en-US')}
        </dd>
      </dl>
    </details>
  );
}

function ShareControl({ result }: { result: BenchmarkResult }) {
  const { status, error, share } = useShare(result);
  const done = status === 'stored' || status === 'duplicate';
  return (
    <div className="xl-share">
      <button
        type="button"
        className="tab xl-share-button"
        disabled={status === 'sending' || done}
        onClick={() => void share()}
      >
        {status === 'sending' ? 'Sending…' : 'Share these measurements'}
      </button>
      <span className="xl-note">
        Sends the timings, conditions and machine details above. Your code and data stay in this browser.
      </span>
      {status === 'stored' && <p role="status">Thanks — your measurements were saved.</p>}
      {status === 'duplicate' && <p role="status">Your observation was added to matching measurements.</p>}
      {status === 'failed' && (
        <p className="xl-error" role="alert">
          {error || 'The measurements were not accepted.'} Your result is still here.
        </p>
      )}
    </div>
  );
}

function ResultView({
  project,
  result,
  build,
}: {
  project: ExampleProject;
  result: BenchmarkResult;
  build: ExampleBuild | null;
}) {
  const [selected, setSelected] = useState<VariantId>('compiled');
  const stale = build !== null && build.sourceHash !== result.sourceHash;
  const timeTerms = [...TIME_TERMS, result.settings.operation];
  return (
    <div className="xl-result" data-equivalent={result.equivalent}>
      <p className={result.equivalent ? 'xl-verdict' : 'xl-verdict xl-warn'} role="status">
        {verdictOf(result)}
        {stale && ' Measured on an earlier compile.'}
      </p>
      <TimingBars result={result} selected={selected} onSelect={setSelected} />
      <TimingTable result={result} />
      <MechanismLinks mechanisms={pickMechanisms(project.mechanisms, timeTerms)} label="Why the timing differs" />
      <ResultDetails result={result} selected={selected} />
      <ShareControl result={result} />
    </div>
  );
}

function RunPanel({
  project,
  build,
  settings,
  onSettings,
}: {
  project: ExampleProject;
  build: ExampleBuild | null;
  settings: RunSettings;
  onSettings: (s: RunSettings) => void;
}) {
  const bench = useBenchmark(project, build, settings);
  return (
    <Panel area="run" title="Measure">
      <SettingsForm project={project} settings={settings} onChange={onSettings} />
      <div className="xl-actions">
        <button
          type="button"
          className="tab runall xl-run"
          disabled={!build || bench.busy}
          onClick={() => void bench.run()}
        >
          {bench.busy ? 'Measuring…' : bench.result ? 'Measure again' : 'Measure'}
        </button>
        {bench.busy && (
          <button type="button" className="tab xl-cancel-run" onClick={bench.cancel}>
            Cancel
          </button>
        )}
        {!build && <span className="xl-note">Compile first to measure.</span>}
        {bench.progress && (
          <span className="xl-progress" role="status">
            {bench.progress.fraction !== null && <progress value={bench.progress.fraction} max={1} />}{' '}
            {bench.progress.label}
          </span>
        )}
      </div>
      <ErrorLine text={bench.error} />
      {bench.result ? (
        <ResultView project={project} result={bench.result} build={build} />
      ) : (
        <div className="xl-empty">
          <p>
            Pick the conditions, then measure: both variants run the same operations and report median, spread and final
            state.
          </p>
          <MechanismLinks mechanisms={pickMechanisms(project.mechanisms, TIME_TERMS)} label="What decides the timing" />
        </div>
      )}
    </Panel>
  );
}

/* ---------- composition ---------- */

function defaultSettings(project: ExampleProject): RunSettings {
  return { ...DEFAULT_SETTINGS, operation: project.operations[0] ?? DEFAULT_SETTINGS.operation };
}

function LabBody({ project }: { project: ExampleProject }) {
  const [file, setFile] = useState(project.defaultFile);
  const [settings, setSettings] = useState(() => defaultSettings(project));
  const { edits, setFile: edit, resetFile } = useEdits(project);
  const compile = useCompile(project, edits);
  return (
    <div className="xl" data-example-lab={project.id}>
      <header className="xl-head">
        <h2>{project.title}</h2>
        <p>{project.summary}</p>
      </header>
      <div className="xl-grid">
        <SourcePanel
          project={project}
          edits={edits}
          file={file}
          onFile={setFile}
          onEdit={edit}
          onReset={resetFile}
          compile={compile}
        />
        <BoardPanel project={project} build={compile.current} settings={settings} />
        <OutputPanel project={project} build={compile.current} previous={compile.previous} />
        <RunPanel project={project} build={compile.current} settings={settings} onSettings={setSettings} />
      </div>
    </div>
  );
}

export function ExampleLab({ id }: { id: string }) {
  const { project, error, retry } = useProject(id);
  if (error) {
    return (
      <div className="xl xl-status" data-example-lab={id}>
        <p className="xl-error" role="alert">
          {error}
        </p>
        <button type="button" className="tab" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="xl xl-status" data-example-lab={id} role="status">
        Loading the example…
      </div>
    );
  }
  return <LabBody key={project.id} project={project} />;
}

/* ---------- Bench overview ---------- */

function OverviewBars({ result }: { result: BenchmarkResult }) {
  const max = Math.max(...result.rows.map((r) => r.medianMs), Number.MIN_VALUE);
  const best = bestIndices(result.rows.map((r) => r.medianMs));
  return (
    <div className="benchbars xl-mini" aria-label="Last measurement in this tab">
      {result.rows.map((row, i) => (
        <div className={`bb${best.includes(i) ? ' xl-best' : ''}`} key={row.variant}>
          <span className="bb-name">{VARIANT_LABELS[row.variant]}</span>
          <span className="bb-bar">
            <span style={{ width: `${Math.max(2, (row.medianMs / max) * 100)}%` }} />
          </span>
          <span className="bb-ms">{fmtMs(row.medianMs)} ms</span>
        </div>
      ))}
      <p className="xl-note">
        {plural(result.settings.count, 'task')} · {OPERATION_LABELS[result.settings.operation].toLowerCase()}
      </p>
    </div>
  );
}

function OverviewCard({ example }: { example: ExampleMetadata }) {
  const last = readLastResult(example.id);
  return (
    <article className="xl-card" data-example-card={example.id}>
      <h3>{example.title}</h3>
      <p>{example.summary}</p>
      <ul className="xl-ops" aria-label="Operations">
        {example.operations.map((op) => (
          <li key={op}>{OPERATION_LABELS[op]}</li>
        ))}
      </ul>
      {last ? (
        <OverviewBars result={last} />
      ) : (
        <MechanismLinks mechanisms={example.mechanisms} label={`How ${example.title} gets smaller and faster`} />
      )}
      <a className="xl-open" href={href(`/repl/${example.id}`)}>
        Open and measure →
      </a>
    </article>
  );
}

/** Bench's view of the same examples the REPL edits: one card each, linking straight to its workbench. */
export function ExampleOverview() {
  return (
    <div className="xl-cards">
      {LAB_EXAMPLES.map((example) => (
        <OverviewCard key={example.id} example={example} />
      ))}
    </div>
  );
}
