/**
 * StateHub - cross-panel state synchronization
 *
 * Holds SharedEditorState as the source of truth.
 * When any panel sends state:update, merges the patch
 * and broadcasts to all other registered panels.
 */

import type { SharedEditorState } from '@lib/types';
import type * as vscode from 'vscode';

export class StateHub {
  private _state: SharedEditorState = {
    selectedIds: [],
    hoveredId: null,
    currentComponent: null,
    astStructure: null,
    canvasMode: 'single',
    engineMode: 'design',
  };

  /** Registered panels by id */
  private _panels = new Map<string, vscode.Webview>();

  /** External listeners for state changes */
  private _listeners: Array<(state: SharedEditorState, patch: Partial<SharedEditorState>) => void> = [];

  get state(): Readonly<SharedEditorState> {
    return this._state;
  }

  /**
   * Register a panel. Immediately sends state:init with current state.
   */
  register(panelId: string, webview: vscode.Webview): void {
    this._panels.set(panelId, webview);

    webview.postMessage({
      type: 'state:init',
      state: this._state,
    });
  }

  /**
   * Unregister a panel (on dispose)
   */
  unregister(panelId: string): void {
    this._panels.delete(panelId);
  }

  /**
   * Apply a partial state update from a specific panel.
   * Merges into state and broadcasts to ALL panels (including sender).
   * Sender echo is needed because preview relies on state:update to render overlays.
   * No infinite loop risk: Left Panel uses zustand with shallow-equal dedup,
   * and preview only reads state without re-emitting.
   */
  applyUpdate(fromPanelId: string, patch: Partial<SharedEditorState>): void {
    // Merge patch into state
    Object.assign(this._state, patch);

    // Notify external listeners
    for (const listener of this._listeners) {
      listener(this._state, patch);
    }

    // Broadcast to ALL panels (including sender — preview needs
    // state echoed back for overlay rendering in the iframe)
    const message = { type: 'state:update', patch };
    for (const [, webview] of this._panels) {
      webview.postMessage(message);
    }
  }

  /**
   * Subscribe to state changes (for extension host logic).
   * Returns unsubscribe function.
   */
  onChange(listener: (state: SharedEditorState, patch: Partial<SharedEditorState>) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  /** Re-send state:init to a specific panel (e.g. after webview:ready) */
  sendInit(panelId: string): void {
    const webview = this._panels.get(panelId);
    if (webview) {
      webview.postMessage({ type: 'state:init', state: this._state });
    }
  }

  dispose(): void {
    this._panels.clear();
    this._listeners.length = 0;
  }
}
