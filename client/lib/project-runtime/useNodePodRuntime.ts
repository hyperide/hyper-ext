import { useCallback, useEffect, useRef, useState } from 'react';
import * as clientFileStore from '@/lib/client-file-store';
import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';
import { authFetch } from '@/utils/authFetch';
import { INERT_POLL_STATUS, type ProjectRuntime, type RuntimeStatus } from './types';

interface UseNodePodRuntimeOptions {
  enabled: boolean;
}

// Minimal typed surface for the NodePod pod instance.
// Dynamic import inside start() keeps the ~3MB package out of the Docker-only bundle.
interface PodInstance {
  fs: { writeFile(path: string, content: string): Promise<void> };
  spawn(cmd: string, args: string[], opts?: { cwd?: string }): Promise<SpawnHandle>;
  teardown(): void;
}
interface SpawnHandle {
  on(event: 'output' | 'error', handler: (t: string) => void): void;
  completion: Promise<{ exitCode: number }>;
}

const INERT: ProjectRuntime = {
  mode: 'nodepod',
  status: 'idle',
  hasBeenRunning: false,
  previewUrl: null,
  logs: [],
  error: null,
  pollStatus: INERT_POLL_STATUS,
  start: async () => {},
  stop: async () => {},
  restart: async () => {},
};

export function useNodePodRuntime(project: ProjectData | null, opts: UseNodePodRuntimeOptions): ProjectRuntime {
  const { enabled } = opts;

  const podRef = useRef<PodInstance | null>(null);
  const runIdRef = useRef(0);

  const [status, setStatus] = useState<RuntimeStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hasBeenRunning, setHasBeenRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => [...prev, line]);
  }, []);

  const start = useCallback(async () => {
    if (!project?.id || !enabled) return;
    if (podRef.current) return;

    const runId = ++runIdRef.current;
    const isStale = () => runId !== runIdRef.current;

    setStatus('starting');
    setLogs([]);
    setError(null);
    setPreviewUrl(null);
    setHasBeenRunning(false);

    try {
      const { Nodepod } = await import('@scelar/nodepod');
      if (isStale()) return;

      appendLog('[nodepod] booting...');
      let resolveServer!: (url: string) => void;
      const serverReady = new Promise<string>((r) => {
        resolveServer = r;
      });

      const pod = await Nodepod.boot({
        watermark: false,
        workdir: '/app',
        onServerReady: (_port: number, url: string) => {
          if (!isStale()) {
            appendLog(`[nodepod] server ready: ${url}`);
            resolveServer(url);
          }
        },
      });
      if (isStale()) {
        pod.teardown();
        return;
      }
      podRef.current = pod;
      appendLog('[nodepod] runtime booted');

      appendLog('[files] loading from OPFS...');
      let files = await clientFileStore.readFiles(project.id);
      if (Object.keys(files).length === 0) {
        appendLog('[files] OPFS empty — bootstrapping from server...');
        const res = await authFetch(`/api/projects/${project.id}/files`);
        if (!res.ok) throw new Error(`Failed to bootstrap files: ${res.status}`);
        const { files: serverFiles } = (await res.json()) as { files: Record<string, string> };
        await clientFileStore.seedFiles(project.id, serverFiles);
        files = serverFiles;
        appendLog(`[files] seeded ${Object.keys(files).length} files into OPFS`);
      } else {
        appendLog(`[files] ${Object.keys(files).length} files from OPFS`);
      }
      if (isStale()) return;

      // Pin Vite to 7.3.1 in both deps fields — Vite 8 has HMR WS bug in NodePod v1.8.2
      const patchedFiles: Record<string, string> = {};
      for (const [path, content] of Object.entries(files)) {
        if (path === 'package.json') {
          try {
            const pkg = JSON.parse(content) as Record<string, unknown>;
            for (const field of ['dependencies', 'devDependencies'] as const) {
              const deps = pkg[field] as Record<string, string> | undefined;
              if (deps?.vite) deps.vite = '7.3.1';
            }
            patchedFiles[path] = JSON.stringify(pkg, null, 2);
          } catch {
            patchedFiles[path] = content;
          }
        } else {
          patchedFiles[path] = content;
        }
      }

      await Promise.all(Object.entries(patchedFiles).map(([rel, content]) => pod.fs.writeFile(`/app/${rel}`, content)));
      appendLog(`[files] ${Object.keys(patchedFiles).length} files mounted`);

      appendLog('[npm] install started...');
      const install = await pod.spawn('npm', ['install'], { cwd: '/app' });
      install.on('output', (t) => appendLog(`[npm] ${t}`));
      install.on('error', (t) => appendLog(`[npm:err] ${t}`));
      const { exitCode: installCode } = await install.completion;
      if (isStale()) return;
      if (installCode !== 0) throw new Error(`npm install failed with exit ${installCode}`);
      appendLog('[npm] install done');

      appendLog('[vite] starting dev server...');
      const dev = await pod.spawn('npm', ['run', 'dev'], { cwd: '/app' });
      dev.on('output', (t) => appendLog(`[vite] ${t}`));
      dev.on('error', (t) => appendLog(`[vite:err] ${t}`));
      dev.completion.then(({ exitCode }) => {
        if (isStale()) return;
        appendLog(`[vite] process exited: ${exitCode}`);
        podRef.current = null;
        setStatus((s) => {
          if (s === 'running') setError('Vite dev server exited unexpectedly');
          return s === 'running' ? 'error' : s;
        });
      });

      const url = await Promise.race([
        serverReady,
        dev.completion.then(({ exitCode }) => Promise.reject(new Error(`vite exited early: ${exitCode}`))),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout 120s waiting for vite')), 120_000)),
      ]);
      if (isStale()) return;

      setPreviewUrl(url);
      setStatus('running');
      setHasBeenRunning(true);
    } catch (err) {
      if (isStale()) return;
      const msg = err instanceof Error ? err.message : String(err);
      appendLog(`[error] ${msg}`);
      setError(msg);
      setStatus('error');
      if (podRef.current) {
        podRef.current.teardown();
        podRef.current = null;
      }
    }
  }, [project?.id, enabled, appendLog]);

  const stop = useCallback(async () => {
    runIdRef.current++;
    setStatus('stopping');
    if (podRef.current) {
      podRef.current.teardown();
      podRef.current = null;
    }
    setPreviewUrl(null);
    setStatus('idle');
    setHasBeenRunning(false);
    setError(null);
  }, []);

  const restart = useCallback(async () => {
    await stop();
    await start();
  }, [stop, start]);

  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runIdRef.current++;
      const pod = podRef.current;
      if (pod) {
        pod.teardown();
        podRef.current = null;
      }
    };
  }, []);

  if (!enabled) return INERT;

  return {
    mode: 'nodepod',
    status,
    hasBeenRunning,
    previewUrl,
    logs,
    error,
    pollStatus: INERT_POLL_STATUS,
    start,
    stop,
    restart,
  };
}
