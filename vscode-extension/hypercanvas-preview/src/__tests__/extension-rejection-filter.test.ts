/**
 * @file Unit tests for isForeignExtensionError — the filter that prevents
 * HyperIDE from logging foreign VS Code extension rejections as [HyperIDE].
 *
 * Accessed via: extension.ts `unhandledRejection` handler (process-level)
 * Assumptions: VS Code extension host shares one Node.js process across all
 *              installed extensions, so unhandled rejections from any extension
 *              surface in every extension's process.on('unhandledRejection').
 * Past bugs: HYP-363 — open.bun-vscode and github.copilot-chat errors were
 *            mislabeled as [HyperIDE] failures.
 */
import { describe, expect, it } from 'bun:test';
import { isForeignExtensionError } from '../extension-utils';

describe('isForeignExtensionError', () => {
  it('returns true for stack pointing to a different extension in .vscode/extensions/', () => {
    const err = new Error('EADDRINUSE');
    err.stack = `Error: EADDRINUSE
    at /Users/ultra/.vscode/extensions/open.bun-vscode-0.1.2/dist/extension.js:1:234
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`;
    expect(isForeignExtensionError(err)).toBe(true);
  });

  it('returns true for github.copilot-chat extension stack', () => {
    const err = new Error('GitHubLoginFailed');
    err.stack = `Error: GitHubLoginFailed
    at /Users/ultra/.vscode/extensions/github.copilot-chat-1.2.3/dist/extension.js:1:500`;
    expect(isForeignExtensionError(err)).toBe(true);
  });

  it('returns false for stack from HyperIDE extension in .vscode/extensions/', () => {
    const err = new Error('HyperIDE error');
    err.stack = `Error: HyperIDE error
    at /Users/ultra/.vscode/extensions/hyperide.hypercanvas-preview-0.1.39/out/extension.js:100:5`;
    expect(isForeignExtensionError(err)).toBe(false);
  });

  it('returns false for stack from extension in development (no .vscode/extensions/ path)', () => {
    const err = new Error('dev mode error');
    err.stack = `Error: dev mode error
    at /home/dev/project/vscode-extension/hypercanvas-preview/out/extension.js:200:10
    at DevServerManager.start (/home/dev/project/vscode-extension/hypercanvas-preview/out/services/DevServerManager.js:50:3)`;
    expect(isForeignExtensionError(err)).toBe(false);
  });

  it('returns false for non-Error reason with no extension paths', () => {
    expect(isForeignExtensionError('network timeout')).toBe(false);
    expect(isForeignExtensionError(42)).toBe(false);
    expect(isForeignExtensionError(null)).toBe(false);
  });

  it('returns false when stack is undefined (Error without stack)', () => {
    const err = new Error('no stack');
    err.stack = undefined;
    expect(isForeignExtensionError(err)).toBe(false);
  });

  it('handles Windows-style paths with backslashes', () => {
    const err = new Error('windows error');
    err.stack = `Error: windows error
    at C:\\Users\\user\\.vscode\\extensions\\open.bun-vscode-0.1.2\\dist\\extension.js:1:234`;
    expect(isForeignExtensionError(err)).toBe(true);
  });

  it('returns true for foreign extension in remote SSH host (.vscode-server/extensions/)', () => {
    const err = new Error('remote error');
    err.stack = `Error: remote error
    at /home/user/.vscode-server/extensions/open.bun-vscode-0.1.2/dist/extension.js:1:234`;
    expect(isForeignExtensionError(err)).toBe(true);
  });

  it('returns false for HyperIDE extension in remote SSH host', () => {
    const err = new Error('HyperIDE remote error');
    err.stack = `Error: HyperIDE remote error
    at /home/user/.vscode-server/extensions/hyperide.hypercanvas-preview-0.1.39/out/extension.js:100:5`;
    expect(isForeignExtensionError(err)).toBe(false);
  });
});
