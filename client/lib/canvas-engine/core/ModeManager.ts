/**
 * @file Mode manager for CanvasEngine
 *
 * Accessed via: CanvasEngine mode methods
 * Assumptions: mode is persisted to localStorage; 'board' mode is handled at UI level
 */

import { loadPersistedState, savePersistedState } from '../../storage';
import type { EventEmitter } from '../events/EventEmitter';
import type { CanvasEngineEvents, CanvasEventName } from '../events/events';

export class ModeManager {
  private mode: 'design' | 'interact' | 'code';
  private events: EventEmitter;

  constructor(events: EventEmitter) {
    this.events = events;
    const persistedMode = loadPersistedState().mode;
    this.mode = (persistedMode === 'board' ? 'interact' : persistedMode) || 'design';
  }

  setMode(mode: 'design' | 'interact' | 'code'): void {
    const previousMode = this.mode;
    if (previousMode === mode) {
      return;
    }
    this.mode = mode;
    savePersistedState({ mode });
    this.events.emit('mode:change' as CanvasEventName, { mode, previousMode } as CanvasEngineEvents['mode:change']);
  }

  getMode(): 'design' | 'interact' | 'code' {
    return this.mode;
  }
}
