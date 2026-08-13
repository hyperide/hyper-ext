/**
 * Bidirectional sync between code cursor position and preview element highlight.
 *
 * Code -> Preview: cursor movement in TSX/JSX auto-highlights element in preview.
 * Preview -> Code: element click in preview auto-navigates to code location.
 *
 * Uses different mechanisms for each direction (webview postMessage vs StateHub),
 * so a simple suppress flag prevents feedback loops.
 *
 * Supports both legacy UUID-based and fiber-based source location resolution.
 * When the iframe sends a source location (fiber path), go-to-code uses it directly
 * without an AST lookup round-trip.
 */

import { toProjectRelative } from '@shared/element-tracing/path-normalization';
import type { SourceLocation } from '@shared/element-tracing/types';
import * as vscode from 'vscode';
import { toRepoRelativePath } from '../bridges/monorepo-path-translate';
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
  /**
   * Source location received with the latest element click.
   * Set by the canvas interaction layer when the iframe sends source alongside elementId.
   * Consumed by _onPreviewSelectionChange for direct go-to-code (no AST lookup).
   */
  private _pendingSource: SourceLocation | null = null;
  /**
   * Sub-project path prefix for a monorepo opened at the repo ROOT (e.g.
   * `targets/conloca-app/`), empty for single-package. The iframe reports click
   * source paths relative to the sub-project (the dev server's root); goToCode
   * resolves against the repo root, so a raw sub-relative path opens
   * `repo/src/...` which does not exist. Re-root it first (HYP-435).
   */
  private _subProjectPrefix = '';

  constructor(
    private readonly _astService: AstService,
    private readonly _stateHub: StateHub,
    private readonly _workspaceRoot: string,
    private readonly _sendGoToVisual: (elementId: string) => void,
    private readonly _getCurrentComponent: () => string | undefined,
  ) {
    this._enabled = vscode.workspace.getConfiguration('hypercanvas.preview').get<boolean>('syncPositions', true);
  }

  /** Pin the monorepo sub-project prefix (empty for single-package). */
  setSubProjectPrefix(prefix: string): void {
    this._subProjectPrefix = prefix;
  }

  /**
   * Store source location from an iframe click event.
   * Called by the canvas interaction layer before StateHub.applyUpdate
   * so that _onPreviewSelectionChange can use it for direct navigation.
   */
  setPendingSource(source: SourceLocation | null): void {
    this._pendingSource = source;
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
        // If the patch includes a source location from fiber-based tracing,
        // store it so _onPreviewSelectionChange can use it directly
        const patchWithSource = patch as Partial<typeof _state> & { source?: SourceLocation };
        if (patchWithSource.source) {
          this._pendingSource = patchWithSource.source;
        }
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
          if (result.nodeRef) {
            this._sendGoToVisual(result.nodeRef);
          }
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

    // Fast path: if the iframe sent a source location with the click,
    // navigate directly — no active component file needed, no AST lookup.
    const pendingSource = this._pendingSource;
    this._pendingSource = null;

    if (pendingSource) {
      try {
        this._suppressCursorSync = true;
        // source.column is 0-based, goToCode expects 1-based column.
        // First normalize the iframe-reported fileName: a cross-package library
        // file is served via Vite's `/@fs/<absolute>` URL, which leaks into the
        // fiber path — toProjectRelative strips `/@fs/` and re-roots against the
        // repo root, yielding `packages/ui/src/Card.tsx` (HYP-443). For an
        // in-package sub-project file the path is already sub-relative, so this is
        // a no-op and toRepoRelativePath then applies the HYP-430 sub→repo prefix.
        const normalized = toProjectRelative(pendingSource.fileName, this._workspaceRoot);
        const fileName = toRepoRelativePath(normalized, this._subProjectPrefix);
        await goToCode(fileName, pendingSource.line, pendingSource.column + 1);
      } finally {
        setTimeout(() => {
          this._suppressCursorSync = false;
        }, SUPPRESS_DURATION_MS);
      }
      return;
    }

    // Legacy fallback: resolve via AST lookup (requires active component)
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
