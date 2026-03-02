/**
 * AI Bridge - handles AI chat messages from webview
 *
 * Standalone mode: calls Anthropic/OpenAI API directly with user's API key.
 * Uses shared runChat() core for Anthropic tool-use loop.
 * OpenAI path remains text-only (no tools).
 */

import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  type ChatEvent,
  FetchAnthropicProvider,
  type MessageParam,
  runChat,
  type ToolExecutor,
  type ToolResult,
} from '../../../../shared/ai-agent-core';
import { ASK_USER, FILE_TOOLS, GET_DIAGNOSTICS, type ToolDefinition } from '../../../../shared/ai-agent-tools';
import { AI_PROVIDER_DEFAULTS, type AIProvider } from '../../../../shared/ai-provider-defaults';
import type { DiagnosticHub } from '../DiagnosticHub';
import type { StateHub } from '../StateHub';
import type { DevServerManager } from '../services/DevServerManager';

/** Minimal shape of AST tree nodes from ComponentService.parseStructure() */
interface AstTreeNode {
  id: string;
  type: string;
  label: string;
  children?: AstTreeNode[];
}

type StreamCallback = (event: { type: string; requestId: string; [key: string]: unknown }) => void;

interface ActiveRequest {
  requestId: string;
  abortController: AbortController;
}

/** Tools implemented by LocalToolExecutor */
const IMPLEMENTED_TOOLS = new Set([
  'read_file',
  'edit_file',
  'write_file',
  'grep_search',
  'glob_search',
  'list_directory',
  'tree',
  'get_diagnostics',
]);

/** Tools available in the extension — only those actually implemented */
const EXTENSION_TOOLS: ToolDefinition[] = [
  ...FILE_TOOLS.filter((t) => IMPLEMENTED_TOOLS.has(t.name)),
  GET_DIAGNOSTICS,
  ASK_USER,
];

/**
 * Executes tools locally on the filesystem
 */
class LocalToolExecutor implements ToolExecutor {
  constructor(
    private readonly _workspaceRoot: string,
    private readonly _devServerManager: DevServerManager | null,
    private readonly _diagnosticHub: DiagnosticHub | null,
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
        case 'get_diagnostics':
          return await this._getDiagnostics(input);
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

  private async _buildTree(dirPath: string, prefix: string, depth: number, includeFiles: boolean): Promise<string> {
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

  private async _getDiagnostics(input: Record<string, unknown>): Promise<ToolResult> {
    const sourcesRaw = (input.sources as string[] | undefined) ?? ['all'];
    const sources = sourcesRaw.includes('all') ? ['server', 'console', 'runtime_error', 'build_status'] : sourcesRaw;
    const maxLines = Math.min(Math.max(Number(input.lines) || 50, 1), 200);
    const levelFilter = (input.level as string) ?? 'all';
    const pattern = input.pattern as string | undefined;
    const since = input.since as number | undefined;

    // If build_status requested, wait a moment for settle
    if (sources.includes('build_status')) {
      await new Promise((r) => setTimeout(r, 3000));
    }

    const results: string[] = [];

    // Server logs from DiagnosticHub (preferred) or fallback to DevServerManager
    if (sources.includes('server')) {
      if (this._diagnosticHub) {
        let logs = this._diagnosticHub.state.logs.filter((l) => l.source === 'server');
        if (since) logs = logs.filter((l) => l.timestamp > since);
        logs = this._filterByLevel(logs, levelFilter);
        if (pattern) {
          // nosemgrep: detect-non-literal-regexp -- AI tool input pattern, extension-local
          const re = new RegExp(pattern, 'i');
          logs = logs.filter((l) => re.test(l.line));
        }
        const lines = logs.slice(-maxLines).map((l) => l.line);
        results.push(`=== Server Logs (${lines.length}) ===\n${lines.join('\n') || '(no logs)'}`);
      } else if (this._devServerManager) {
        const logs = this._devServerManager.getLogs().slice(-maxLines);
        results.push(`=== Server Logs (${logs.length}) ===\n${logs.map((l) => l.line).join('\n') || '(no logs)'}`);
      }
    }

    // Console logs
    if (sources.includes('console') && this._diagnosticHub) {
      let logs = this._diagnosticHub.state.logs.filter((l) => l.source === 'console');
      if (since) logs = logs.filter((l) => l.timestamp > since);
      logs = this._filterByLevel(logs, levelFilter);
      if (pattern) {
        // nosemgrep: detect-non-literal-regexp -- AI tool input pattern, extension-local
        const re = new RegExp(pattern, 'i');
        logs = logs.filter((l) => re.test(l.line));
      }
      const lines = logs.slice(-maxLines).map((l) => `[${l.level ?? 'log'}] ${l.line}`);
      if (lines.length > 0) {
        results.push(`=== Console Output (${lines.length}) ===\n${lines.join('\n')}`);
      }
    }

    // Runtime error
    if (sources.includes('runtime_error')) {
      const runtimeError = this._diagnosticHub?.runtimeError ?? this._devServerManager?.runtimeError ?? null;
      if (runtimeError) {
        const parts = [`${runtimeError.type}: ${runtimeError.message}`];
        if (runtimeError.file) {
          parts.push(`File: ${runtimeError.file}${runtimeError.line ? `:${runtimeError.line}` : ''}`);
        }
        if (runtimeError.codeframe) parts.push(`Code:\n${runtimeError.codeframe}`);
        results.push(`=== Runtime Error (${runtimeError.framework}) ===\n${parts.join('\n')}`);
      }
    }

    // Build status
    if (sources.includes('build_status')) {
      const status = this._diagnosticHub?.state.buildStatus ?? 'unknown';
      const hasErrors = this._devServerManager?.hasErrors ?? false;
      results.push(`=== Build Status ===\nStatus: ${status}\nErrors: ${hasErrors ? 'yes' : 'no'}`);
    }

    if (results.length === 0) {
      return { success: true, output: 'No diagnostic data available.' };
    }

    return { success: true, output: results.join('\n\n') };
  }

  private _filterByLevel(logs: Array<{ isError: boolean; level?: string }>, levelFilter: string): typeof logs {
    if (levelFilter === 'all') return logs;
    if (levelFilter === 'error') return logs.filter((l) => l.isError || l.level === 'error');
    if (levelFilter === 'warn') return logs.filter((l) => l.isError || l.level === 'error' || l.level === 'warn');
    return logs;
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
  private _diagnosticHub: DiagnosticHub | null = null;
  private _stateHub: StateHub | null = null;
  /** Pending ask_user responses: toolUseId -> resolve function */
  private _pendingUserResponses = new Map<string, (response: string) => void>();

  constructor(
    private readonly _workspaceRoot: string,
    private readonly _context: vscode.ExtensionContext,
  ) {}

  /**
   * Set the StateHub for injecting editor context into system prompt
   */
  setStateHub(stateHub: StateHub): void {
    this._stateHub = stateHub;
  }

  /**
   * Set the dev server manager for fallback log access
   */
  setDevServerManager(manager: DevServerManager): void {
    this._devServerManager = manager;
  }

  /**
   * Set the diagnostic hub for get_diagnostics tool
   */
  setDiagnosticHub(hub: DiagnosticHub): void {
    this._diagnosticHub = hub;
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
      let apiKey = await this._getApiKey();
      if (!apiKey) {
        await vscode.commands.executeCommand('hypercanvas.configureAIKey');
        apiKey = await this._getApiKey();
        if (!apiKey) {
          callback({ type: 'ai:error', requestId, error: 'API key not configured.' });
          return;
        }
      }

      // Re-read config — user may have changed provider in the wizard
      const freshConfig = vscode.workspace.getConfiguration('hypercanvas.ai');
      const freshProvider = freshConfig.get<string>('provider', 'glm') as AIProvider;
      const freshDefaults = AI_PROVIDER_DEFAULTS[freshProvider] ?? AI_PROVIDER_DEFAULTS.glm;
      const freshModel = freshConfig.get<string>('model') || freshDefaults.model;
      const baseURL = freshConfig.get<string>('baseURL') || freshDefaults.baseURL;

      if (freshDefaults.protocol === 'openai') {
        await this._streamOpenAI(
          requestId,
          apiKey,
          freshModel,
          baseURL || 'https://api.openai.com/v1',
          messages,
          abortController.signal,
          callback,
        );
      } else {
        await this._streamAnthropic(
          requestId,
          apiKey,
          freshModel,
          baseURL ?? undefined,
          messages,
          abortController.signal,
          callback,
        );
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
   * Provide a user response to a pending ask_user tool call
   */
  provideUserResponse(toolUseId: string, response: string): void {
    const resolve = this._pendingUserResponses.get(toolUseId);
    if (resolve) {
      resolve(response);
      this._pendingUserResponses.delete(toolUseId);
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
    // Reject all pending ask_user responses
    for (const [id, resolve] of this._pendingUserResponses) {
      resolve('(cancelled)');
      this._pendingUserResponses.delete(id);
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
    for (const [id, resolve] of this._pendingUserResponses) {
      resolve('(cancelled)');
      this._pendingUserResponses.delete(id);
    }
  }

  private async _getApiKey(): Promise<string | undefined> {
    return this._context.secrets.get('hypercanvas.ai.apiKey');
  }

  /**
   * Stream from Anthropic API using shared runChat() core
   */
  private async _streamAnthropic(
    requestId: string,
    apiKey: string,
    model: string,
    baseUrl: string | undefined,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    signal: AbortSignal,
    callback: StreamCallback,
  ): Promise<void> {
    const streamProvider = new FetchAnthropicProvider({ apiKey, baseUrl });
    const localExecutor = new LocalToolExecutor(this._workspaceRoot, this._devServerManager, this._diagnosticHub);

    // Wrap executor to intercept ask_user tool
    const executor: ToolExecutor = {
      execute: async (name: string, input: Record<string, unknown>) => {
        if (name === 'ask_user') {
          return this._handleAskUser(requestId, input, callback);
        }
        return localExecutor.execute(name, input);
      },
    };

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
   * Handle ask_user tool: send question to webview, wait for user response
   */
  private async _handleAskUser(
    requestId: string,
    input: Record<string, unknown>,
    callback: StreamCallback,
  ): Promise<ToolResult> {
    const toolUseId = `ask-${Date.now()}`;
    const question = String(input.question ?? '');
    const options = input.options as string[] | undefined;

    // Send ask_user event to webview
    callback({
      type: 'ai:askUser',
      requestId,
      toolUseId,
      question,
      options,
    });

    // Wait for user response via pending promise
    const userResponse = await new Promise<string>((resolve) => {
      this._pendingUserResponses.set(toolUseId, resolve);
    });

    return { success: true, output: userResponse };
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
          toolName: event.toolName,
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
    baseURL: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    signal: AbortSignal,
    callback: StreamCallback,
  ): Promise<void> {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: this._getSystemPrompt() }, ...messages],
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
    const hasDiagnostics = this._diagnosticHub !== null || this._devServerManager !== null;
    const devServerInstructions = hasDiagnostics
      ? `\n\nWhen fixing errors:
1. Read the relevant files to understand the issue
2. Make targeted edits to fix the problem
3. After editing, use get_diagnostics with sources: ["build_status", "server"] to verify the fix
4. If errors persist, analyze the new error and iterate
5. Continue until build is clean or 3 fix attempts made`
      : '';

    const editorContext = this._buildEditorContext();

    return `You are a helpful coding assistant embedded in a VS Code extension called HyperCanvas.
You help fix build errors and improve code in React projects.
The user's project is located at: ${this._workspaceRoot}

You have access to tools for reading, editing, and searching files.${devServerInstructions}${editorContext}

Be concise. Focus on fixing the actual error.`;
  }

  /**
   * Build editor context section from StateHub snapshot.
   * Includes current component, selected elements, and AST overview.
   */
  private _buildEditorContext(): string {
    if (!this._stateHub) return '';

    const state = this._stateHub.state;
    const parts: string[] = [];

    // Current component
    if (state.currentComponent) {
      parts.push(`Current file: ${state.currentComponent.path} (component: ${state.currentComponent.name})`);
    }

    // UI kit
    if (state.projectUIKit && state.projectUIKit !== 'none') {
      parts.push(`UI framework: ${state.projectUIKit}`);
    }

    // Selected elements
    if (state.selectedIds.length > 0) {
      const selectedInfo = this._describeSelectedElements(state.selectedIds, state.astStructure);
      parts.push(
        `Selected element${state.selectedIds.length > 1 ? 's' : ''} (by data-uniq-id):\n${selectedInfo}\n` +
          'When the user refers to "this element", "selected element", or "it", they mean these element(s). ' +
          'Use the data-uniq-id attribute to find corresponding JSX elements in the source code.',
      );
    }

    // AST overview (compact tree)
    if (state.astStructure && Array.isArray(state.astStructure) && state.astStructure.length > 0) {
      const tree = this._formatAstTree(state.astStructure as AstTreeNode[], 0, 4);
      if (tree) {
        parts.push(`Component structure:\n${tree}`);
      }
    }

    if (parts.length === 0) return '';
    return `\n\n## Current editor context\n${parts.join('\n')}`;
  }

  /**
   * Describe selected elements by looking them up in the AST tree
   */
  private _describeSelectedElements(selectedIds: string[], astStructure: unknown[] | null): string {
    if (!astStructure || !Array.isArray(astStructure)) {
      return selectedIds.join(', ');
    }

    const descriptions: string[] = [];
    for (const id of selectedIds) {
      const node = this._findAstNode(id, astStructure as AstTreeNode[]);
      if (node) {
        descriptions.push(`- ${node.label} [${node.type}] (data-uniq-id="${id}")`);
      } else {
        descriptions.push(`- ${id}`);
      }
    }
    return descriptions.join('\n');
  }

  /**
   * Find a node by id in the AST tree (depth-first)
   */
  private _findAstNode(id: string, nodes: AstTreeNode[]): AstTreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = this._findAstNode(id, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Format AST tree as indented text, limited to maxDepth levels
   */
  private _formatAstTree(nodes: AstTreeNode[], depth: number, maxDepth: number): string {
    if (depth >= maxDepth || nodes.length === 0) return '';

    const lines: string[] = [];
    for (const node of nodes) {
      const indent = '  '.repeat(depth);
      lines.push(`${indent}- ${node.label} [${node.type}]`);
      if (node.children && node.children.length > 0) {
        const childTree = this._formatAstTree(node.children, depth + 1, maxDepth);
        if (childTree) lines.push(childTree);
      }
    }
    return lines.join('\n');
  }
}
