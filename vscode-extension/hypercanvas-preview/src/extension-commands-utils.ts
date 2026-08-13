import * as vscode from 'vscode';

/**
 * Matches the `url = "http://127.0.0.1:<port>/mcp[?token=...]"` line in a Codex `config.toml`.
 * The optional `(?:\?[^"]*)?` group tolerates the `?token=<bearer>` query the URL now carries
 * (HyperMcpServer.url) so a re-write replaces the whole prior value, token and all, instead of
 * appending a duplicate. Single source (shared-util-single-source): both the auto-update path
 * and writeCodexConfig() replace with this — a future host/port-format change touches one place.
 */
const CODEX_MCP_URL_LINE = /url\s*=\s*"http:\/\/127\.0\.0\.1:\d+\/mcp(?:\?[^"]*)?"/;

/**
 * Auto-update existing MCP config files with the new port (and bearer token — the URL is
 * `http://127.0.0.1:<port>/mcp?token=<token>`, see HyperMcpServer.url). Called on every
 * extension activation to keep both in sync, since a fresh token is minted per start().
 */
export async function autoUpdateMcpConfigs(workspaceRoot: string, url: string): Promise<void> {
  // Check and update .mcp.json (Claude Code)
  const mcpJsonPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.mcp.json');
  try {
    const content = await vscode.workspace.fs.readFile(mcpJsonPath);
    const config = JSON.parse(new TextDecoder().decode(content));
    if (config?.mcpServers?.['hyper-canvas']) {
      config.mcpServers['hyper-canvas'].url = url;
      await vscode.workspace.fs.writeFile(mcpJsonPath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
      console.log('[HyperMCP] Updated .mcp.json with new port');
    }
  } catch {
    // File doesn't exist or no hyper-canvas entry — skip
  }

  // Check and update .vscode/mcp.json (Copilot)
  const vscodeMcpPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.vscode', 'mcp.json');
  try {
    const content = await vscode.workspace.fs.readFile(vscodeMcpPath);
    const config = JSON.parse(new TextDecoder().decode(content));
    if (config?.servers?.['hyper-canvas']) {
      config.servers['hyper-canvas'].url = url;
      await vscode.workspace.fs.writeFile(vscodeMcpPath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
      console.log('[HyperMCP] Updated .vscode/mcp.json with new port');
    }
  } catch {
    // File doesn't exist or no hyper-canvas entry — skip
  }

  // Check and update opencode.json
  const opencodePath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), 'opencode.json');
  try {
    const content = await vscode.workspace.fs.readFile(opencodePath);
    const config = JSON.parse(new TextDecoder().decode(content));
    if (config?.mcp?.['hyper-canvas']) {
      config.mcp['hyper-canvas'].url = url;
      await vscode.workspace.fs.writeFile(opencodePath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
      console.log('[HyperMCP] Updated opencode.json with new port');
    }
  } catch {
    // File doesn't exist or no hyper-canvas entry — skip
  }

  // Check and update .codex/config.toml (Codex)
  const codexConfigPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.codex', 'config.toml');
  try {
    const content = await vscode.workspace.fs.readFile(codexConfigPath);
    const toml = new TextDecoder().decode(content);
    if (toml.includes('hyper-canvas')) {
      const updated = toml.replace(CODEX_MCP_URL_LINE, `url = "${url}"`);
      await vscode.workspace.fs.writeFile(codexConfigPath, Buffer.from(updated, 'utf-8'));
      console.log('[HyperMCP] Updated .codex/config.toml with new port');
    }
  } catch {
    // File doesn't exist or no hyper-canvas entry — skip
  }
}

export interface ConfiguredAgents {
  copilot: boolean;
  claudeCode: boolean;
  codex: boolean;
  opencode: boolean;
}

export async function detectConfiguredAgents(workspaceRoot: string): Promise<ConfiguredAgents> {
  const result: ConfiguredAgents = { copilot: false, claudeCode: false, codex: false, opencode: false };

  const tryRead = async (relativePath: string): Promise<string | null> => {
    try {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), relativePath);
      const content = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder().decode(content);
    } catch {
      return null;
    }
  };

  const vscodeMcp = await tryRead('.vscode/mcp.json');
  if (vscodeMcp) {
    try {
      result.copilot = !!JSON.parse(vscodeMcp)?.servers?.['hyper-canvas'];
    } catch {
      /* invalid json */
    }
  }

  const mcpJson = await tryRead('.mcp.json');
  if (mcpJson) {
    try {
      result.claudeCode = !!JSON.parse(mcpJson)?.mcpServers?.['hyper-canvas'];
    } catch {
      /* invalid json */
    }
  }

  const codexToml = await tryRead('.codex/config.toml');
  if (codexToml) {
    result.codex = codexToml.includes('hyper-canvas');
  }

  const opencodeJson = await tryRead('opencode.json');
  if (opencodeJson) {
    try {
      result.opencode = !!JSON.parse(opencodeJson)?.mcp?.['hyper-canvas'];
    } catch {
      /* invalid json */
    }
  }

  return result;
}

export async function writeVsCodeMcpJson(workspaceRoot: string, url: string): Promise<void> {
  const vscodeDir = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.vscode');
  try {
    await vscode.workspace.fs.stat(vscodeDir);
  } catch {
    await vscode.workspace.fs.createDirectory(vscodeDir);
  }

  const mcpJsonPath = vscode.Uri.joinPath(vscodeDir, 'mcp.json');
  let config: Record<string, unknown> = { servers: {} };

  try {
    const content = await vscode.workspace.fs.readFile(mcpJsonPath);
    config = JSON.parse(new TextDecoder().decode(content));
    if (!config.servers) config.servers = {};
  } catch {
    // File doesn't exist — use default
  }

  (config.servers as Record<string, unknown>)['hyper-canvas'] = {
    type: 'http',
    url,
  };

  await vscode.workspace.fs.writeFile(mcpJsonPath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
}

export async function writeMcpJson(workspaceRoot: string, url: string): Promise<void> {
  const mcpJsonPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.mcp.json');
  let config: Record<string, unknown> = { mcpServers: {} };

  try {
    const content = await vscode.workspace.fs.readFile(mcpJsonPath);
    config = JSON.parse(new TextDecoder().decode(content));
    if (!config.mcpServers) config.mcpServers = {};
  } catch {
    // File doesn't exist — use default
  }

  (config.mcpServers as Record<string, unknown>)['hyper-canvas'] = {
    type: 'http',
    url,
  };

  await vscode.workspace.fs.writeFile(mcpJsonPath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
}

export async function writeOpenCodeJson(workspaceRoot: string, url: string): Promise<void> {
  const opencodePath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), 'opencode.json');
  let config: Record<string, unknown> = {};

  try {
    const content = await vscode.workspace.fs.readFile(opencodePath);
    config = JSON.parse(new TextDecoder().decode(content));
  } catch {
    // File doesn't exist — use default
  }

  if (!config.mcp) config.mcp = {};
  (config.mcp as Record<string, unknown>)['hyper-canvas'] = {
    type: 'remote',
    url,
  };

  await vscode.workspace.fs.writeFile(opencodePath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
}

export async function writeCodexConfig(workspaceRoot: string, url: string): Promise<void> {
  const codexDir = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.codex');
  try {
    await vscode.workspace.fs.stat(codexDir);
  } catch {
    await vscode.workspace.fs.createDirectory(codexDir);
  }

  const configPath = vscode.Uri.joinPath(codexDir, 'config.toml');
  let toml = '';

  try {
    const content = await vscode.workspace.fs.readFile(configPath);
    toml = new TextDecoder().decode(content);
  } catch {
    // File doesn't exist — start fresh
  }

  if (toml.includes('[mcp_servers.hyper-canvas]')) {
    // Update existing entry
    toml = toml.replace(CODEX_MCP_URL_LINE, `url = "${url}"`);
  } else {
    // Append new entry
    const entry = `\n[mcp_servers.hyper-canvas]\ntype = "http"\nurl = "${url}"\n`;
    toml = `${toml.trimEnd()}\n${entry}`;
  }

  await vscode.workspace.fs.writeFile(configPath, Buffer.from(toml, 'utf-8'));
}

export async function installChromeForPlaywright(): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Installing Chrome for Playwright MCP...',
      cancellable: false,
    },
    () =>
      new Promise<void>((resolve, reject) => {
        const { execFile } = require('node:child_process');
        const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        execFile(npx, ['playwright', 'install', 'chrome'], { timeout: 120_000 }, (error: Error | null) => {
          if (error) {
            vscode.window.showErrorMessage(
              'Failed to install Chrome for Playwright. Run manually: npx playwright install chrome',
            );
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  );
}

export interface CompanionConfig {
  id: string;
  command: string;
  args: string[];
}

export async function writeCompanionServers(
  workspaceRoot: string,
  agentIds: Array<'copilot' | 'claude-code' | 'codex' | 'opencode'>,
  companions: CompanionConfig[],
): Promise<void> {
  for (const agentId of agentIds) {
    if (agentId === 'copilot') {
      await mergeStdioServers('.vscode/mcp.json', 'servers', workspaceRoot, companions);
    } else if (agentId === 'claude-code') {
      await mergeStdioServers('.mcp.json', 'mcpServers', workspaceRoot, companions);
    } else if (agentId === 'opencode') {
      await mergeStdioServers('opencode.json', 'mcp', workspaceRoot, companions);
    } else if (agentId === 'codex') {
      await appendCodexCompanions(workspaceRoot, companions);
    }
  }
}

async function mergeStdioServers(
  relativePath: string,
  serversKey: string,
  workspaceRoot: string,
  companions: CompanionConfig[],
): Promise<void> {
  const filePath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), relativePath);
  let config: Record<string, Record<string, unknown>> = {};

  try {
    const content = await vscode.workspace.fs.readFile(filePath);
    config = JSON.parse(new TextDecoder().decode(content));
  } catch {
    return; // File should already exist from step 1
  }

  const servers = (config[serversKey] ?? {}) as Record<string, unknown>;
  for (const c of companions) {
    if (!servers[c.id]) {
      servers[c.id] = { command: c.command, args: c.args };
    }
  }
  config[serversKey] = servers;

  await vscode.workspace.fs.writeFile(filePath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
}

async function appendCodexCompanions(workspaceRoot: string, companions: CompanionConfig[]): Promise<void> {
  const configPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.codex', 'config.toml');
  let toml = '';

  try {
    const content = await vscode.workspace.fs.readFile(configPath);
    toml = new TextDecoder().decode(content);
  } catch {
    return; // File should already exist from step 1
  }

  for (const c of companions) {
    if (!toml.includes(`[mcp_servers.${c.id}]`)) {
      const argsToml = c.args.map((a) => `"${a}"`).join(', ');
      const entry = `\n[mcp_servers.${c.id}]\ncommand = "${c.command}"\nargs = [${argsToml}]\n`;
      toml = `${toml.trimEnd()}\n${entry}`;
    }
  }

  await vscode.workspace.fs.writeFile(configPath, Buffer.from(toml, 'utf-8'));
}

/**
 * Register MCP server with VS Code Copilot (1.99+).
 * Uses runtime check — no engine version bump needed.
 *
 * `url` is the full authenticated URL from HyperMcpServer.url (`?token=<bearer token>`) — the
 * server rejects unauthenticated requests, so this must be the live value, not a port-only
 * reconstruction.
 */
export function registerCopilotMcp(context: vscode.ExtensionContext, url: string): void {
  const lm = vscode.lm as Record<string, unknown> | undefined;
  if (typeof lm?.registerMcpServerDefinitionProvider !== 'function') {
    console.log('[HyperMCP] vscode.lm.registerMcpServerDefinitionProvider not available (VS Code < 1.99)');
    return;
  }

  try {
    const McpHttpServerDefinition = (vscode as Record<string, unknown>).McpHttpServerDefinition as
      | (new (label: string, uri: vscode.Uri, headers?: Record<string, string>, version?: string) => unknown)
      | undefined;

    if (!McpHttpServerDefinition) {
      console.log('[HyperMCP] vscode.McpHttpServerDefinition not available');
      return;
    }

    const didChangeEmitter = new vscode.EventEmitter<void>();
    context.subscriptions.push(didChangeEmitter);

    type RegisterFn = (id: string, provider: Record<string, unknown>) => vscode.Disposable | undefined;
    const register = lm.registerMcpServerDefinitionProvider as RegisterFn;
    const disposable = register('hypercanvas.mcpServer', {
      onDidChangeMcpServerDefinitions: didChangeEmitter.event,
      provideMcpServerDefinitions: async () => [
        new McpHttpServerDefinition(
          'HyperCanvas',
          vscode.Uri.parse(url),
          undefined,
          context.extension.packageJSON.version,
        ),
      ],
    });

    if (disposable) {
      context.subscriptions.push(disposable);
      console.log('[HyperMCP] Registered Copilot MCP server provider');
    }
  } catch (err) {
    console.error('[HyperMCP] Failed to register Copilot MCP provider:', err);
  }
}
