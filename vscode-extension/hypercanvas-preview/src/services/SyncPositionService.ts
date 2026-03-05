/**
 * Bidirectional sync between code cursor position and preview element highlight.
 *
 * Code -> Preview: cursor movement in TSX/JSX auto-highlights element in preview.
 * Preview -> Code: element click in preview auto-navigates to code location.
 *
 * Uses different mechanisms for each direction (webview postMessage vs StateHub),
 * so a simple suppress flag prevents feedback loops.
 */

import * as vscode from 'vscode';
import { goToCode } from '../EditorBridge';
import type { StateHub } from '../StateHub';
import type { AstService } from './AstService';

const CURSOR_DEBOUNCE_MS = 300;
const SUPPRESS_DURATION_MS = 100;

export class SyncPositionService implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = [];
  private _enabled: boolean;
  private _suppressCursorSync = false;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly _astService: AstService,
    private readonly _stateHub: StateHub,
    private readonly _workspaceRoot: string,
    private readonly _sendGoToVisual: (elementId: string) => void,
    private readonly _getCurrentComponent: () => string | undefined,
  ) {
    this._enabled = vscode.workspace.getConfiguration('hypercanvas.preview').get<boolean>('syncPositions', true);
  }

  start(): void {
    // Code -> Preview: cursor selection changes
    this._disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        this._onCursorChange(e);
      }),
    );

    // Preview -> Code: selectedIds changes in StateHub
    const unsub = this._stateHub.onChange((_state, patch) => {
      if (patch.selectedIds !== undefined) {
        this._onPreviewSelectionChange(patch.selectedIds);
      }
    });
    this._disposables.push({ dispose: unsub });

    // Setting hot-reload
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('hypercanvas.preview.syncPositions')) {
          this._enabled = vscode.workspace.getConfiguration('hypercanvas.preview').get<boolean>('syncPositions', true);
        }
      }),
    );
  }

  dispose(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }

  // -- Code -> Preview --

  private _onCursorChange(e: vscode.TextEditorSelectionChangeEvent): void {
    if (!this._enabled || this._suppressCursorSync) return;

    const editor = e.textEditor;
    const filePath = editor.document.uri.fsPath;

    // Only TSX/JSX files
    if (!/\.(tsx|jsx)$/.test(filePath)) return;

    // Must match current component
    const component = this._getCurrentComponent();
    if (!component) return;

    const relativePath = this._getRelativePath(filePath);
    if (relativePath !== component) return;

    // Debounce
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    const position = editor.selection.active;
    const line = position.line + 1;
    const column = position.character + 1;

    this._debounceTimer = setTimeout(async () => {
      try {
        const result = await this._astService.findElementAtPosition(filePath, line, column);

        if (result) {
          // Suppress reverse sync (Preview→Code) before updating StateHub
          this._suppressCursorSync = true;
          this._sendGoToVisual(result.uuid);
          setTimeout(() => {
            this._suppressCursorSync = false;
          }, SUPPRESS_DURATION_MS);
        }
      } catch {
        // Silently ignore — cursor might be in non-JSX code
      }
    }, CURSOR_DEBOUNCE_MS);
  }

  // -- Preview -> Code --

  private async _onPreviewSelectionChange(selectedIds: string[]): Promise<void> {
    if (!this._enabled) return;
    if (this._suppressCursorSync) return;
    if (selectedIds.length !== 1) return;

    const component = this._getCurrentComponent();
    if (!component) return;

    const elementId = selectedIds[0];

    try {
      const loc = await this._astService.getElementLocation(component, elementId);

      if (loc) {
        // Suppress cursor listener to prevent feedback loop
        this._suppressCursorSync = true;

        await goToCode(component, loc.line, loc.column + 1);

        setTimeout(() => {
          this._suppressCursorSync = false;
        }, SUPPRESS_DURATION_MS);
      }
    } catch {
      // Silently ignore — element might not exist in AST anymore
    }
  }

  private _getRelativePath(absolutePath: string): string | undefined {
    if (absolutePath.startsWith(this._workspaceRoot)) {
      return absolutePath.substring(this._workspaceRoot.length + 1);
    }
    return undefined;
  }
}
