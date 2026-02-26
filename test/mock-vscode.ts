/**
 * Preload mock for the `vscode` module.
 *
 * bun:test loads this before any test file runs, so every
 * `import * as vscode from 'vscode'` resolves to these fakes.
 *
 * Only covers APIs actually used by our extension code.
 * Add new stubs here when tests need them.
 */

import { beforeEach, mock } from 'bun:test';

/* ---------- value types ---------- */

class MockPosition {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

class MockRange {
  constructor(
    public readonly start: MockPosition,
    public readonly end: MockPosition,
  ) {}
}

class MockSelection extends MockRange {
  constructor(
    public readonly anchor: MockPosition,
    public readonly active: MockPosition,
  ) {
    super(anchor, active);
  }
}

class MockUri {
  constructor(
    public scheme: string,
    public authority: string,
    public path: string,
  ) {
    this.fsPath = path;
  }

  fsPath: string;
  static file(p: string) {
    return new MockUri('file', '', p);
  }

  static joinPath(base: MockUri, ...segments: string[]) {
    return new MockUri(base.scheme, base.authority, [base.path, ...segments].join('/'));
  }
}

class MockEventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(listener);
        if (idx !== -1) this.listeners.splice(idx, 1);
      },
    };
  };

  fire(data: T) {
    for (const listener of this.listeners) listener(data);
  }

  dispose() {
    this.listeners.length = 0;
  }
}

/* ---------- enums ---------- */

const ViewColumn = { One: 1, Two: 2, Three: 3, Active: -1, Beside: -2 };
const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 };
const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

/* ---------- TabInputWebview stub ---------- */

class TabInputWebview {
  constructor(public readonly viewType: string) {}
}

/* ---------- namespace: window ---------- */

const window = {
  activeTextEditor: undefined as unknown,
  showInformationMessage: mock(() => Promise.resolve(undefined)),
  showErrorMessage: mock(() => Promise.resolve(undefined)),
  showWarningMessage: mock(() => Promise.resolve(undefined)),
  showTextDocument: mock(() => Promise.resolve({ selection: null, revealRange: mock() })),
  createOutputChannel: mock(() => ({
    appendLine: mock(),
    append: mock(),
    show: mock(),
    dispose: mock(),
  })),
  onDidChangeActiveTextEditor: mock(() => ({ dispose: mock() })),
  tabGroups: { all: [] as unknown[] },
};

/* ---------- namespace: workspace ---------- */

const workspace = {
  workspaceFolders: [{ uri: MockUri.file('/test-workspace'), name: 'test', index: 0 }],
  openTextDocument: mock(() => Promise.resolve({ getText: () => '', uri: MockUri.file('/test') })),
  fs: {
    readFile: mock(() => Promise.resolve(new Uint8Array())),
    writeFile: mock(() => Promise.resolve()),
    delete: mock(() => Promise.resolve()),
    stat: mock(() => Promise.resolve({ type: FileType.File })),
    createDirectory: mock(() => Promise.resolve()),
    readDirectory: mock(() => Promise.resolve([])),
  },
};

/* ---------- namespace: commands ---------- */

const commands = {
  registerCommand: mock((_cmd: string, _cb: (...args: never) => unknown) => ({ dispose: mock() })),
  executeCommand: mock(() => Promise.resolve()),
};

/* ---------- register mock ---------- */

mock.module('vscode', () => ({
  Uri: MockUri,
  Position: MockPosition,
  Range: MockRange,
  Selection: MockSelection,
  EventEmitter: MockEventEmitter,
  ViewColumn,
  TextEditorRevealType,
  FileType,
  TabInputWebview,
  window,
  workspace,
  commands,
}));

/* ---------- reset between tests ---------- */

const allMockFns = [
  window.showInformationMessage,
  window.showErrorMessage,
  window.showWarningMessage,
  window.showTextDocument,
  window.createOutputChannel,
  window.onDidChangeActiveTextEditor,
  workspace.openTextDocument,
  workspace.fs.readFile,
  workspace.fs.writeFile,
  workspace.fs.delete,
  workspace.fs.stat,
  workspace.fs.createDirectory,
  workspace.fs.readDirectory,
  commands.registerCommand,
  commands.executeCommand,
];

beforeEach(() => {
  for (const fn of allMockFns) fn.mockClear();
  window.activeTextEditor = undefined;
  window.tabGroups = { all: [] as unknown[] };
});
