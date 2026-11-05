import type { RunSettings } from './types';
export function resolveSourcePath(directory: string, path: string): string {
  if (!path || /[:\\]/.test(path) || path.includes('\0') || (!path.startsWith('.') && !path.startsWith('/')))
    throw new Error('Only local project imports are available');
  const parts = path.startsWith('/') ? [] : directory.split('/').filter(Boolean);
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) throw new Error('Import leaves the project');
      parts.pop();
    } else parts.push(segment);
  }
  return `/${parts.join('/')}`;
}
export function summarizeSamples(samples: readonly number[]) {
  if (!samples.length || samples.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('Invalid timing sample');
  const ordered = [...samples].sort((a, b) => a - b);
  return {
    medianMs: ordered[Math.floor(ordered.length / 2)],
    p95Ms: ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)],
  };
}
export function validateRunSettings(value: RunSettings): RunSettings {
  if (
    !Number.isSafeInteger(value.count) ||
    value.count < 1 ||
    value.count > 10000 ||
    !['point', 'dense', 'sparse', 'move', 'history'].includes(value.operation) ||
    !Number.isSafeInteger(value.samples) ||
    value.samples < 3 ||
    value.samples > 17 ||
    !Number.isSafeInteger(value.historyLimit) ||
    value.historyLimit < 1 ||
    value.historyLimit > 1000 ||
    typeof value.includeSetup !== 'boolean'
  )
    throw new Error('Choose a supported workload and sample count');
  return {
    count: value.count,
    operation: value.operation,
    samples: value.samples,
    historyLimit: value.historyLimit,
    includeSetup: value.includeSetup,
  };
}
export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface CompilerManifest {
  rustSources: Record<string, string>;
  harness: Record<string, string>;
  assets: Record<string, { sha256: string }>;
}
/** Exclude unrelated examples and presentation metadata from measured-code identity. */
export function compilerIdentity(manifest: CompilerManifest) {
  const sorted = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.keys(values)
        .sort()
        .map((key) => [key, values[key]]),
    );
  return {
    rustSources: sorted(manifest.rustSources),
    harness: sorted(manifest.harness),
    assets: Object.fromEntries(
      ['statec.js', 'statec_bg.wasm', 'esbuild.wasm'].map((name) => {
        if (typeof manifest.assets[name]?.sha256 !== 'string') throw new Error('Compiler manifest is incomplete');
        return [name, manifest.assets[name].sha256];
      }),
    ),
  };
}

export function timingRelation(a: number, b: number): 'timer-floor' | 'tie' | 'different' {
  return a <= 0 || b <= 0 ? 'timer-floor' : a === b ? 'tie' : 'different';
}
/** Serialize source into an HTML script without entering comment/double-escaped states. */
export function scriptString(source: string): string {
  return JSON.stringify(source).replaceAll('<', '\\u003c');
}
