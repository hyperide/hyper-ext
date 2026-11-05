import { LAB_EXAMPLES } from '../../data/example-lab/catalogue';
import { executeInSandbox } from './execution-sandbox';
import { validateRunSettings } from './core';
import type {
  ExampleProject,
  ExampleBuild,
  RunSettings,
  BenchmarkResult,
  PreviewState,
  PreviewAction,
  RunRow,
  VariantId,
} from './types';
export async function loadProject(id: string, signal?: AbortSignal): Promise<ExampleProject> {
  const example = LAB_EXAMPLES.find((entry) => entry.id === id);
  if (!example) throw new Error('Unknown example');
  const exampleId = example.id;
  const response = await fetch(`/lab/${exampleId}.json`, { signal });
  if (!response.ok) throw new Error('Could not load the example source');
  const project: ExampleProject = await response.json();
  if (project.id !== exampleId || !project.files) throw new Error('Invalid example source');
  return project;
}
export function compileProject(
  project: ExampleProject,
  edits: Record<string, string>,
  signal?: AbortSignal,
): Promise<ExampleBuild> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    const worker = new Worker(new URL('./compiler.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Compilation took too long. Reduce the example size.'));
    }, 60000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Compiler failed to load'));
    };
    worker.postMessage({ id: 1, project, edits });
  });
}
export async function previewProject(
  build: ExampleBuild,
  settings: RunSettings,
  actions: PreviewAction[] = [],
  signal?: AbortSignal,
): Promise<PreviewState> {
  return executeInSandbox<PreviewState>(
    { kind: 'preview', code: build.artifacts.compiled.code, settings: validateRunSettings(settings), actions },
    signal,
  );
}
function environment() {
  const ua = navigator.userAgent,
    match = ua.match(/(Firefox|Edg|Chrome)\/(\d+)/) ?? ua.match(/(Version)\/(\d+)/);
  const engine = !match ? 'Other' : match[1] === 'Firefox' ? 'Firefox' : match[1] === 'Version' ? 'Safari' : 'Chromium';
  const platform = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Other';
  let last = performance.now(),
    resolution = Infinity;
  for (let i = 0; i < 10000; i++) {
    const next = performance.now();
    if (next > last) resolution = Math.min(resolution, next - last);
    last = next;
  }
  return {
    engine,
    engineVersion: match?.[2] ?? 'unknown',
    platform,
    timerResolutionMs: Number.isFinite(resolution) ? resolution : 1,
  };
}
export async function runBenchmark(
  build: ExampleBuild,
  settings: RunSettings,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<BenchmarkResult> {
  const chosen = validateRunSettings(settings),
    rows: RunRow[] = [];
  const order: VariantId[] =
    crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? ['reference', 'compiled'] : ['compiled', 'reference'];
  for (const variant of order) {
    onProgress?.(variant === 'reference' ? 'Measuring runtime commands…' : 'Measuring compiled commands…');
    const row = await executeInSandbox<Omit<RunRow, 'variant'>>(
      { kind: 'benchmark', code: build.artifacts[variant].code, settings: chosen },
      signal,
    );
    if (
      !row ||
      !Array.isArray(row.samplesMs) ||
      row.samplesMs.length !== chosen.samples ||
      row.samplesMs.some((x) => !Number.isFinite(x) || x < 0)
    )
      throw new Error('The example returned invalid measurements');
    rows.push({ ...row, variant });
  }
  rows.sort((a, b) => (a.variant === 'reference' ? -1 : b.variant === 'reference' ? 1 : 0));
  const result: BenchmarkResult = {
    version: 1,
    exampleId: build.example.id,
    sourceHash: build.sourceHash,
    sourceRevision: build.sourceRevision,
    settings: chosen,
    rows,
    equivalent: rows[0].checksum === rows[1].checksum,
    environment: environment(),
    createdAt: new Date().toISOString(),
  };
  const { saveLocalMeasurement } = await import('./measurement-store');
  await saveLocalMeasurement(result).catch(() => undefined);
  return result;
}
export async function submitMeasurement(result: BenchmarkResult): Promise<{ stored: boolean; duplicate: boolean }> {
  if (!result.equivalent) throw new Error('The implementations must return the same state before sharing a comparison');
  const response = await fetch('/api/measurements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Sharing is temporarily unavailable. Your run remains on this device.');
  return response.json();
}
