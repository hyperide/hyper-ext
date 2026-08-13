/**
 * @file Wiring tests for the Hyper Canvas activation layout (HYP-804 / tg#5070+tg#5073).
 *
 * Two product rules, both invisible to the unit layer except through the command wiring:
 *   1. Opening Hyper Canvas (`hypercanvas.openPreview`) ALSO reveals the Hyper Explorer
 *      and the Inspector, but must NOT reveal/focus the AI Chat — chat is hidden by
 *      default and user-invoked (package.json `aiChatView` visibility `"collapsed"`).
 *   2. `hypercanvas.toggleCodeCanvasLayout` flips the editor area between
 *      code-left/canvas-right (orientation 0) and code-top/canvas-bottom (orientation 1)
 *      via `vscode.setEditorLayout`, keeping the canvas in the second editor group.
 *
 * These invoke the REAL registered handlers (via registerCommands + the preloaded vscode
 * mock). A contributions tripwire on package.json guards the declarative half (the
 * collapsed default + the toggle command) that the handler tests cannot see.
 *
 * Assumptions: vscode is mocked by the preload (test/mock-vscode.ts); `executeCommand`
 * and `registerCommand` are bun mocks whose recorded calls we read.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { registerCommands, type CommandContext } from '../extension-commands';

/** Read the recorded calls of a bun-mocked function (the `vscode` module declares these
 *  as plain functions, so the bun `mock` metadata needs a localized cast). */
function recordedArgs(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls;
}

interface CtxFakes {
  createOrShow: ReturnType<typeof mock>;
  inspectorFocus: ReturnType<typeof mock>;
  chatFocus: ReturnType<typeof mock>;
}

/** Build a CommandContext with just the fields these two commands read, plus spies. */
function makeCtx(): { ctx: CommandContext; fakes: CtxFakes } {
  const createOrShow = mock(() => {});
  const inspectorFocus = mock(() => Promise.resolve());
  const chatFocus = mock(() => Promise.resolve());
  const ctx = {
    previewPanel: { createOrShow, setPreviewUrl: mock(() => {}) },
    devServerManager: null,
    diagnosticHub: null,
    aiChatProvider: { focusAndEnsureReady: chatFocus },
    rightPanelProvider: { focusAndEnsureReady: inspectorFocus },
    leftPanelProvider: null,
    logsProvider: null,
    stateHub: null,
    panelRouter: null,
    getMcpServer: () => null,
    prepareDevServerTargetRef: null,
    rerootDevServerTargetRef: null,
    getWorkspaceRoot: () => '/test-workspace',
  } as unknown as CommandContext;
  return { ctx, fakes: { createOrShow, inspectorFocus, chatFocus } };
}

function registerAndGetHandler(commandId: string, ctx: CommandContext): (...a: never[]) => unknown {
  const fakeContext = { subscriptions: [] as Array<{ dispose(): void }> };
  registerCommands(fakeContext as unknown as vscode.ExtensionContext, '/test-workspace', ctx);
  const entry = recordedArgs(vscode.commands.registerCommand).find((c) => c[0] === commandId);
  if (!entry) throw new Error(`${commandId} was not registered`);
  return entry[1] as (...a: never[]) => unknown;
}

function executeCommandCalledWith(commandId: string): boolean {
  return recordedArgs(vscode.commands.executeCommand).some((c) => c[0] === commandId);
}

describe('hypercanvas.openPreview — reveals Explorer + Inspector, hides AI Chat (HYP-804)', () => {
  it('reveals the Explorer and Inspector views on open', () => {
    const { ctx, fakes } = makeCtx();
    const handler = registerAndGetHandler('hypercanvas.openPreview', ctx);

    handler();

    expect(fakes.createOrShow).toHaveBeenCalled();
    expect(executeCommandCalledWith('hypercanvas.explorerView.focus')).toBe(true);
    expect(fakes.inspectorFocus).toHaveBeenCalledTimes(1);
  });

  it('does NOT reveal or focus the AI Chat view on open (chat hidden by default)', () => {
    const { ctx, fakes } = makeCtx();
    const handler = registerAndGetHandler('hypercanvas.openPreview', ctx);

    handler();

    expect(executeCommandCalledWith('hypercanvas.aiChatView.focus')).toBe(false);
    expect(fakes.chatFocus).not.toHaveBeenCalled();
  });
});

describe('hypercanvas.toggleCodeCanvasLayout — flips code/canvas orientation (HYP-804)', () => {
  /** Pull the orientation from each recorded `vscode.setEditorLayout` call, in order. */
  function setEditorLayoutOrientations(): number[] {
    return recordedArgs(vscode.commands.executeCommand)
      .filter((c) => c[0] === 'vscode.setEditorLayout')
      .map((c) => (c[1] as { orientation: number }).orientation);
  }

  it('first invocation stacks the canvas below the code (orientation 1) in editor group 2', async () => {
    const { ctx, fakes } = makeCtx();
    const handler = registerAndGetHandler('hypercanvas.toggleCodeCanvasLayout', ctx);

    await handler();

    // Canvas is pushed to the SECOND group (becomes the bottom row under vertical orientation).
    expect(fakes.createOrShow).toHaveBeenCalledWith(vscode.ViewColumn.Two);
    expect(setEditorLayoutOrientations()).toEqual([1]);
  });

  it('flips back to side-by-side (orientation 0) on the second invocation', async () => {
    const { ctx } = makeCtx();
    const handler = registerAndGetHandler('hypercanvas.toggleCodeCanvasLayout', ctx);

    await handler();
    await handler();

    expect(setEditorLayoutOrientations()).toEqual([1, 0]);
  });
});

describe('package.json contributions tripwire (HYP-804)', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf-8')) as {
    contributes: {
      views: Record<string, Array<{ id: string; visibility?: string }>>;
      commands: Array<{ command: string; title: string }>;
    };
  };

  it('declares the AI Chat view collapsed by default (hidden, still user-openable)', () => {
    const inspectorViews = pkg.contributes.views['hypercanvas-inspector'];
    const aiChat = inspectorViews.find((v) => v.id === 'hypercanvas.aiChatView');
    expect(aiChat).toBeDefined();
    expect(aiChat?.visibility).toBe('collapsed');
  });

  it('keeps the Inspector view in the same container WITHOUT a collapsed default', () => {
    const inspectorViews = pkg.contributes.views['hypercanvas-inspector'];
    const inspector = inspectorViews.find((v) => v.id === 'hypercanvas.inspectorView');
    expect(inspector).toBeDefined();
    // Inspector must not inherit the chat's collapsed default — it is revealed on canvas open.
    expect(inspector?.visibility).not.toBe('collapsed');
  });

  it('contributes the Code/Canvas layout toggle command', () => {
    const cmd = pkg.contributes.commands.find((c) => c.command === 'hypercanvas.toggleCodeCanvasLayout');
    expect(cmd).toBeDefined();
    expect(cmd?.title).toBe('Hyper: Toggle Code/Canvas Layout');
  });
});
