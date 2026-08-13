import type { ContainerPhase, ProjectStatus } from '@shared/types/statuses';

export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
export type RuntimeMode = 'docker' | 'nodepod';

export interface PollStatus {
  lastPoll: Date | null;
  lastResult: { running: boolean; status: ProjectStatus; phase?: ContainerPhase } | null;
  isPolling: boolean;
}

export const INERT_POLL_STATUS: PollStatus = {
  lastPoll: null,
  lastResult: null,
  isPolling: false,
};

export interface ProjectRuntime {
  mode: RuntimeMode;
  status: RuntimeStatus;
  hasBeenRunning: boolean;
  previewUrl: string | null;
  logs: string[];
  error: string | null;
  pollStatus: PollStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  /** Write a file to the project FS and OPFS. NodePod: triggers Vite HMR. Docker: no-op. */
  writeFile(path: string, content: string): Promise<void>;
}
