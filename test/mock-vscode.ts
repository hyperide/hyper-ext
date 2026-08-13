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
const StatusBarAlignment = { Left: 1, Right: 2 };
const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };

/* ---------- TabInputWebview stub ---------- */

class TabInputWebview {
  constructor(public readonly viewType: string) {}
}

class TabInputText {
  constructor(public readonly uri: MockUri) {}
}

class MockRelativePattern {
  constructor(
    public readonly base: unknown,
    public readonly pattern: string,
  ) {}
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
  visibleTextEditors: [] as unknown[],
  tabGroups: { all: [] as unknown[] },
  createStatusBarItem: mock(() => ({
    text: '',
    tooltip: '',
    command: '',
    show: mock(),
    hide: mock(),
    dispose: mock(),
  })),
  // Runs the task immediately with a no-op progress/token — good enough for unit
  // tests that just need the wrapped work to execute and resolve/reject.
  withProgress: mock((_options: unknown, task: (progress: unknown, token: unknown) => unknown) =>
    Promise.resolve(task({ report: mock() }, { isCancellationRequested: false })),
  ),
};

/* ---------- namespace: env ---------- */

const env = {
  clipboard: {
    writeText: mock(() => Promise.resolve()),
    readText: mock(() => Promise.resolve('')),
  },
};

/* ---------- WorkspaceEdit ---------- */

class MockWorkspaceEdit {
  private _edits: Array<{ uri: MockUri; range: MockRange; newText: string }> = [];

  replace(uri: MockUri, range: MockRange, newText: string) {
    this._edits.push({ uri, range, newText });
  }

  /** Expose recorded edits for test assertions */
  get edits() {
    return this._edits;
  }
}

/* ---------- namespace: workspace ---------- */

const workspace = {
  workspaceFolders: [{ uri: MockUri.file('/test-workspace'), name: 'test', index: 0 }],
  getConfiguration: mock(() => ({
    get: <T>(_key: string, defaultValue?: T) => defaultValue,
  })),
  openTextDocument: mock(() =>
    Promise.resolve({
      getText: () => '',
      positionAt: (o: number) => new MockPosition(0, o),
      uri: MockUri.file('/test'),
      save: mock(() => Promise.resolve(true)),
    }),
  ),
  applyEdit: mock(() => Promise.resolve(true)),
  textDocuments: [] as Array<{ uri: MockUri; getText: () => string }>,
  createFileSystemWatcher: mock(() => ({
    onDidChange: mock(() => ({ dispose: mock() })),
    onDidCreate: mock(() => ({ dispose: mock() })),
    onDidDelete: mock(() => ({ dispose: mock() })),
    dispose: mock(),
  })),
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

/* ---------- namespace: languages (HYP-991 — post-edit diagnostic watcher) ---------- */

// Matches VS Code's real numeric enum: Error=0, Warning=1, Information=2, Hint=3.
const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

const languages = {
  getDiagnostics: mock(() => [] as Array<[MockUri, unknown[]]>),
  onDidChangeDiagnostics: mock((_cb: (...args: never) => unknown) => ({ dispose: mock() })),
};

/* ---------- register mock ---------- */

mock.module('vscode', () => ({
  Uri: MockUri,
  Position: MockPosition,
  Range: MockRange,
  Selection: MockSelection,
  EventEmitter: MockEventEmitter,
  WorkspaceEdit: MockWorkspaceEdit,
  RelativePattern: MockRelativePattern,
  ViewColumn,
  TextEditorRevealType,
  FileType,
  StatusBarAlignment,
  ProgressLocation,
  TabInputWebview,
  TabInputText,
  window,
  workspace,
  commands,
  languages,
  DiagnosticSeverity,
  env,
}));

/* ---------- reset between tests ---------- */

const allMockFns = [
  window.showInformationMessage,
  window.showErrorMessage,
  window.showWarningMessage,
  window.showTextDocument,
  window.createOutputChannel,
  window.onDidChangeActiveTextEditor,
  window.createStatusBarItem,
  window.withProgress,
  env.clipboard.writeText,
  env.clipboard.readText,
  workspace.getConfiguration,
  workspace.openTextDocument,
  workspace.applyEdit,
  workspace.fs.readFile,
  workspace.fs.writeFile,
  workspace.fs.delete,
  workspace.fs.stat,
  workspace.fs.createDirectory,
  workspace.fs.readDirectory,
  commands.registerCommand,
  commands.executeCommand,
  languages.getDiagnostics,
  languages.onDidChangeDiagnostics,
];

beforeEach(() => {
  for (const fn of allMockFns) fn.mockClear();

  // Restore default implementations — mockClear does NOT reset mockImplementation,
  // so overrides from one test file leak into the next (e.g. EditorBridge → AstBridge).
  workspace.openTextDocument.mockImplementation(() =>
    Promise.resolve({
      getText: () => '',
      positionAt: (o: number) => new MockPosition(0, o),
      uri: MockUri.file('/test'),
      save: mock(() => Promise.resolve(true)),
      isDirty: false,
    }),
  );
  workspace.applyEdit.mockImplementation(() => Promise.resolve(true));
  window.showTextDocument.mockImplementation(() => Promise.resolve({ selection: null, revealRange: mock() }));
  commands.executeCommand.mockImplementation(() => Promise.resolve());
  languages.getDiagnostics.mockImplementation(() => [] as Array<[MockUri, unknown[]]>);
  languages.onDidChangeDiagnostics.mockImplementation(() => ({ dispose: mock() }));

  window.activeTextEditor = undefined;
  window.visibleTextEditors = [];
  window.tabGroups = { all: [] as unknown[] };
  workspace.workspaceFolders = [{ uri: MockUri.file('/test-workspace'), name: 'test', index: 0 }];
  workspace.textDocuments.length = 0;
});
