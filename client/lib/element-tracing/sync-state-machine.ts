/**
 * @file Client-side sync state machine for element tracing
 *
 * Accessed via: ElementTracer — manages click availability during HMR/map-update race
 * Assumptions: Both HMR completion and map update arrive within timeoutMs (3000 default)
 */

import type { SyncState } from '../../../shared/element-tracing/types';

interface ClickEntry {
  handler: (...args: unknown[]) => void;
  args: unknown[];
}

interface TracingSyncStateMachineOptions {
  onStateChange?: (state: SyncState) => void;
  timeoutMs?: number;
}

export class TracingSyncStateMachine {
  private _state: SyncState = 'synced';
  private _queue: ClickEntry[] = [];
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private readonly _onStateChange: ((state: SyncState) => void) | undefined;
  private readonly _timeoutMs: number;

  constructor(options: TracingSyncStateMachineOptions = {}) {
    this._onStateChange = options.onStateChange;
    this._timeoutMs = options.timeoutMs ?? 3000;
  }

  get state(): SyncState {
    return this._state;
  }

  fileChanged(): void {
    this.clearTimer();
    this.setState('awaiting-both');
    this.startTimer();
  }

  mapReceived(): void {
    if (this._state === 'awaiting-both') {
      this.setState('awaiting-hmr');
    } else if (this._state === 'awaiting-map') {
      this.syncCompleted();
    }
  }

  hmrCompleted(): void {
    if (this._state === 'awaiting-both') {
      this.setState('awaiting-map');
    } else if (this._state === 'awaiting-hmr') {
      this.syncCompleted();
    }
  }

  queueClick(entry: { handler: (...args: unknown[]) => void; args: unknown[] }): boolean {
    if (this._state === 'synced') {
      return false;
    }
    this._queue.push(entry);
    return true;
  }

  dispose(): void {
    this.clearTimer();
    this._queue = [];
  }

  private setState(state: SyncState): void {
    this._state = state;
    this._onStateChange?.(state);
  }

  private syncCompleted(): void {
    this.clearTimer();
    this.setState('synced');
    this.replayQueue();
  }

  private replayQueue(): void {
    const entries = this._queue;
    this._queue = [];
    for (const entry of entries) {
      entry.handler(...entry.args);
    }
  }

  private startTimer(): void {
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._state !== 'synced') {
        this.syncCompleted();
      }
    }, this._timeoutMs);
  }

  private clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
