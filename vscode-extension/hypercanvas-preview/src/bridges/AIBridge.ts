/**
 * AI Bridge - handles AI chat messages from webview
 *
 * Standalone mode: calls Anthropic/OpenAI API directly with user's API key.
 * Uses shared runChat() core for Anthropic tool-use loop.
 * OpenAI path remains text-only (no tools).
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import {
  runChat,
  FetchAnthropicProvider,
  type ToolExecutor,
  type ToolResult,
  type ChatEvent,
  type MessageParam,
} from '../../../../shared/ai-agent-core';
import {
  FILE_TOOLS,
  CHECK_BUILD_STATUS,
  type ToolDefinition,
} from '../../../../shared/ai-agent-tools';
import type { DevServerManager } from '../services/DevServerManager';

type StreamCallback = (event: {
  type: string;
  requestId: string;
  [key: string]: unknown;
}) => void;

interface ActiveRequest {
  requestId: string;
  abortController: AbortController;
}

/** Tools implemented by LocalToolExecutor */
const IMPLEMENTED_TOOLS = new Set([
  'read_file', 'edit_file', 'write_file', 'grep_search',
  'glob_search', 'list_directory', 'tree', 'check_build_status',
]);

/** Tools available in the extension — only those actually implemented */
const EXTENSION_TOOLS: ToolDefinition[] = [
  ...FILE_TOOLS.filter((t) => IMPLEMENTED_TOOLS.has(t.name)),
  CHECK_BUILD_STATUS,
];

/**
 * Executes tools locally on the filesystem
 */
class LocalToolExecutor implements ToolExecutor {
  constructor(
    private readonly _workspaceRoot: string,
    private readonly _devServerManager: DevServerManager | null,
  ) {}

  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (name) {
        case 'read_file':
          return await this._readFile(input);
        case 'edit_file':
          return await this._editFile(input);
        case 'write_file':
          return await this._writeFile(input);
        case 'grep_search':
          return await this._grepSearch(input);
        case 'glob_search':
          return await this._globSearch(input);
        case 'list_directory':
          return await this._listDirectory(input);
        case 'tree':
          return await this._tree(input);
        case 'check_build_status':
          return await this._checkBuildStatus(input);
        default:
          return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    }
  }

  private _resolvePath(filePath: string): string {
    const resolved = path.resolve(this._workspaceRoot, filePath);
    if (resolved !== this._workspaceRoot && !resolved.startsWith(this._workspaceRoot + path.sep)) {
      throw new Error(`Path "${filePath}" is outside workspace`);
    }
    return resolved;
  }

  private async _readFile(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = this._resolvePath(input.path as string);
    let content = await fs.readFile(filePath, 'utf-8');

    const startLine = input.startLine as number | undefined;
    const endLine = input.endLine as number | undefined;
    if (startLine || endLine) {
      const lines = content.split('\n');
      const start = Math.max((startLine ?? 1) - 1, 0);
      const end = endLine ?? lines.length;
      content = lines.slice(start, end).join('\n');
    }

    return { success: true, output: content };
  }

  private async _editFile(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = this._resolvePath(input.path as string);
    const oldContent = (input.oldContent ?? input.old_content) as string;
    const newContent = (input.newContent ?? input.new_content) as string;
    const replaceAll = input.replaceAll as boolean | undefined;

    const fileContent = await fs.readFile(filePath, 'utf-8');
    if (!fileContent.includes(oldContent)) {
      return { success: false, error: 'oldContent not found in file' };
    }

    const updated = replaceAll
      ? fileContent.replaceAll(oldContent, newContent)
      : fileContent.replace(oldContent, newContent);
    await fs.writeFile(filePath, updated, 'utf-8');
    return { success: true, output: `File updated: ${input.path}` };
  }

  private async _writeFile(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = this._resolvePath(input.path as string);
    const content = input.content as string;
    const createDirs = (input.createDirs as boolean) ?? true;

    if (createDirs) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    }

    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true, output: `File written: ${input.path}` };
  }

  private async _grepSearch(input: Record<string, unknown>): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = input.path ? this._resolvePath(input.path as string) : this._workspaceRoot;
    const filePattern = input.filePattern as string | undefined;
    const caseSensitive = input.caseSensitive as boolean | undefined;

    const flags = caseSensitive ? '' : '-i';
    const includeFlag = filePattern ? `--include='${filePattern}'` : '';
    const cmd = `grep -rn ${flags} ${includeFlag} -- ${this._shellEscape(pattern)} ${this._shellEscape(searchPath)} 2>/dev/null | head -100`;

    return this._execCommand(cmd);
  }

  private async _globSearch(input: Record<string, unknown>): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = input.path ? this._resolvePath(input.path as string) : this._workspaceRoot;

    // Use -path for glob patterns with '/' (e.g. **/*.ts, src/*.tsx), -name for simple patterns (e.g. *.ts)
    const stripped = pattern.replace(/^\*\*\//, '');
    const matchFlag = stripped.includes('/') ? '-path' : '-name';
    const matchPattern = matchFlag === '-path' ? `*/${stripped}` : stripped;

    const cmd = `find ${this._shellEscape(searchPath)} -path '*/node_modules' -prune -o -path '*/.git' -prune -o ${matchFlag} ${this._shellEscape(matchPattern)} -print 2>/dev/null | head -100`;

    return this._execCommand(cmd);
  }

  private async _listDirectory(input: Record<string, unknown>): Promise<ToolResult> {
    const dirPath = this._resolvePath(input.path as string);
    const showHidden = input.showHidden as boolean | undefined;

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'));

    const lines: string[] = [];
    for (const entry of filtered) {
      const type = entry.isDirectory() ? 'dir' : 'file';
      try {
        const stat = await fs.stat(path.join(dirPath, entry.name));
        const size = entry.isDirectory() ? '-' : `${stat.size}b`;
        lines.push(`${type}\t${size}\t${entry.name}`);
      } catch {
        lines.push(`${type}\t-\t${entry.name}`);
      }
    }

    return { success: true, output: lines.join('\n') || '(empty directory)' };
  }

  private async _tree(input: Record<string, unknown>): Promise<ToolResult> {
    const dirPath = this._resolvePath((input.path as string) || '.');
    const maxDepth = (input.maxDepth as number) ?? 3;
    const includeFiles = (input.includeFiles as boolean) ?? true;

    const result = await this._buildTree(dirPath, '', maxDepth, includeFiles);
    return { success: true, output: result || '(empty)' };
  }

  private async _buildTree(
    dirPath: string,
    prefix: string,
    depth: number,
    includeFiles: boolean,
  ): Promise<string> {
    if (depth <= 0) return '';

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const filtered = entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    const lines: string[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      const isLast = i === filtered.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      if (entry.isDirectory()) {
        lines.push(`${prefix}${connector}${entry.name}/`);
        const children = await this._buildTree(
          path.join(dirPath, entry.name),
          prefix + childPrefix,
          depth - 1,
          includeFiles,
        );
        if (children) lines.push(children);
      } else if (includeFiles) {
        lines.push(`${prefix}${connector}${entry.name}`);
      }
    }

    return lines.join('\n');
  }

  private async _checkBuildStatus(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this._devServerManager) {
      return { success: false, error: 'Dev server not available' };
    }

    const waitSec = Math.min(Math.max(Number(input.waitSeconds) || 3, 1), 10);
    await new Promise((r) => setTimeout(r, waitSec * 1000));

    const logs = this._devServerManager.getLogs();
    const hasBuildErrors = this._devServerManager.hasErrors;
    const runtimeError = this._devServerManager.runtimeError;

    const recentLogs = logs
      .slice(-30)
      .map((l) => l.line)
      .join('\n');

    if (!hasBuildErrors && !runtimeError) {
      return { success: true, output: 'Status: OK\nNo build errors or runtime errors detected.' };
    }

    const parts: string[] = ['Status: ERROR'];

    if (hasBuildErrors) {
      const errorLines = logs
        .filter((l) => l.isError)
        .slice(-10)
        .map((l) => l.line)
        .join('\n');
      parts.push(`Build errors:\n${errorLines}`);
    }

    if (runtimeError) {
      parts.push(`Runtime error (${runtimeError.framework}): ${runtimeError.type}\n${runtimeError.message}`);
      if (runtimeError.file) parts.push(`File: ${runtimeError.file}${runtimeError.line ? `:${runtimeError.line}` : ''}`);
      if (runtimeError.codeframe) parts.push(`Code:\n${runtimeError.codeframe}`);
    }

    parts.push(`Recent logs:\n${recentLogs}`);

    return { success: true, output: parts.join('\n\n') };
  }

  private _shellEscape(str: string): string {
    return `'${str.replace(/'/g, "'\\''")}'`;
  }

  private _execCommand(cmd: string): Promise<ToolResult> {
    return new Promise((resolve) => {
      exec(cmd, { maxBuffer: 1024 * 1024, timeout: 15000 }, (error, stdout, stderr) => {
        if (error && !stdout) {
          resolve({ success: false, error: stderr || error.message });
          return;
        }
        resolve({ success: true, output: stdout || stderr || '(no output)' });
      });
    });
  }
}

export class AIBridge {
  private _activeRequest: ActiveRequest | null = null;
  private _devServerManager: DevServerManager | null = null;

  constructor(
    private readonly _workspaceRoot: string,
    private readonly _context: vscode.ExtensionContext,
  ) {}

  /**
   * Set the dev server manager for check_build_status tool
   */
  setDevServerManager(manager: DevServerManager): void {
    this._devServerManager = manager;
  }

  /**
   * Handle a chat request from webview
   */
  async handleChat(
    requestId: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    callback: StreamCallback,
  ): Promise<void> {
    // Cancel any existing request
    if (this._activeRequest) {
      this._activeRequest.abortController.abort();
    }

    const abortController = new AbortController();
    this._activeRequest = { requestId, abortController };

    try {
      const config = vscode.workspace.getConfiguration('hypercanvas.ai');
      const provider = config.get<string>('provider', 'anthropic');
      const model = config.get<string>('model', 'claude-sonnet-4-20250514');

      const apiKey = await this._getApiKey(provider);
      if (!apiKey) {
        callback({
          type: 'ai:error',
          requestId,
          error: 'No API key configured. Run "HyperCanvas: Configure AI API Key" command first.',
        });
        return;
      }

      if (provider === 'anthropic') {
        await this._streamAnthropic(requestId, apiKey, model, messages, abortController.signal, callback);
      } else {
        await this._streamOpenAI(requestId, apiKey, model, messages, abortController.signal, callback);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      callback({ type: 'ai:error', requestId, error: errorMsg });
    } finally {
      if (this._activeRequest?.requestId === requestId) {
        this._activeRequest = null;
      }
    }
  }

  /**
   * Abort active request
   */
  abort(requestId: string): void {
    if (this._activeRequest?.requestId === requestId) {
      this._activeRequest.abortController.abort();
      this._activeRequest = null;
    }
  }

  /**
   * Cleanup
   */
  dispose(): void {
    if (this._activeRequest) {
      this._activeRequest.abortController.abort();
      this._activeRequest = null;
    }
  }

  private async _getApiKey(provider: string): Promise<string | undefined> {
    const secretKey =
      provider === 'anthropic'
        ? 'hypercanvas.anthropicApiKey'
        : 'hypercanvas.openaiApiKey';
    return this._context.secrets.get(secretKey);
  }

  /**
   * Stream from Anthropic API using shared runChat() core
   */
  private async _streamAnthropic(
    requestId: string,
    apiKey: string,
    model: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    signal: AbortSignal,
    callback: StreamCallback,
  ): Promise<void> {
    const streamProvider = new FetchAnthropicProvider({ apiKey });
    const executor = new LocalToolExecutor(this._workspaceRoot, this._devServerManager);

    for await (const event of runChat({
      provider: streamProvider,
      executor,
      model,
      system: this._getSystemPrompt(),
      messages: messages as MessageParam[],
      tools: EXTENSION_TOOLS,
      signal,
    })) {
      this._emitChatEvent(requestId, event, callback);
    }

    callback({ type: 'ai:done', requestId });
  }

  /**
   * Convert ChatEvent to webview callback events
   */
  private _emitChatEvent(requestId: string, event: ChatEvent, callback: StreamCallback): void {
    switch (event.type) {
      case 'text_delta':
        callback({ type: 'ai:delta', requestId, text: event.text });
        break;

      case 'tool_use_end':
        callback({
          type: 'ai:toolUse',
          requestId,
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          input: event.input,
        });
        break;

      case 'tool_use_result':
        callback({
          type: 'ai:toolResult',
          requestId,
          toolUseId: event.toolUseId,
          result: event.result,
        });
        break;

      case 'error':
        callback({ type: 'ai:error', requestId, error: event.error });
        break;
    }
  }

  /**
   * Stream from OpenAI API (text-only, no tools)
   */
  private async _streamOpenAI(
    requestId: string,
    apiKey: string,
    model: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    signal: AbortSignal,
    callback: StreamCallback,
  ): Promise<void> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: this._getSystemPrompt() },
          ...messages,
        ],
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            callback({ type: 'ai:done', requestId });
            return;
          }
          if (!data) continue;

          try {
            const event = JSON.parse(data);
            const delta = event.choices?.[0]?.delta?.content;
            if (delta) {
              callback({ type: 'ai:delta', requestId, text: delta });
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    callback({ type: 'ai:done', requestId });
  }

  private _getSystemPrompt(): string {
    const hasDevServer = this._devServerManager !== null;
    const devServerInstructions = hasDevServer
      ? `\n\nWhen fixing errors:
1. Read the relevant files to understand the issue
2. Make targeted edits to fix the problem
3. After editing, ALWAYS use check_build_status to verify the fix worked
4. If errors persist, analyze the new error and iterate
5. Continue until build is clean or 3 fix attempts made`
      : '';

    return `You are a helpful coding assistant embedded in a VS Code extension called HyperCanvas.
You help fix build errors and improve code in React projects.
The user's project is located at: ${this._workspaceRoot}

You have access to tools for reading, editing, and searching files.${devServerInstructions}

Be concise. Focus on fixing the actual error.`;
  }
}
