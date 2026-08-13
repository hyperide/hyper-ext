import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import * as vscode from 'vscode';
import { AI_PROVIDER_DEFAULTS, type AIProvider } from '../../../shared/ai-provider-defaults';
import {
  FIREPASS_INFO,
  GLM_RECOMMENDATION,
  PROVIDER_KEY_URLS,
  PROVIDER_LABELS,
} from '../../../shared/ai-provider-info';
import { AIChatPanelProvider } from './AIChatPanelProvider';
import { DiagnosticHub } from './DiagnosticHub';
import { LeftPanelProvider } from './LeftPanelProvider';
import { LogsPanelProvider } from './LogsPanelProvider';
import { HyperMcpServer } from './mcp/HyperMcpServer';
import { PanelRouter } from './PanelRouter';
import { PreviewPanel } from './PreviewPanel';
import { detectBrowserForPlaywright } from './playwright-chrome';
import { RightPanelProvider } from './RightPanelProvider';
import { StateHub } from './StateHub';
import { AstService } from './services/AstService';
import { DevServerManager } from './services/DevServerManager';
import { detectPackageManager, detectUnsupportedProject } from './services/ProjectDetector';
import { VSCodeFileIO } from './vscode-file-io';
import {
  detectConfiguredAgents,
  installChromeForPlaywright,
  writeCodexConfig,
  writeCompanionServers,
  writeMcpJson,
  writeOpenCodeJson,
  writeVsCodeMcpJson,
} from './extension-commands-utils';

/**
 * Dependencies needed by command handlers.
 */
export interface CommandContext {
  previewPanel: PreviewPanel | null;
  devServerManager: DevServerManager | null;
  diagnosticHub: DiagnosticHub | null;
  aiChatProvider: AIChatPanelProvider | null;
  rightPanelProvider: RightPanelProvider | null;
  leftPanelProvider: LeftPanelProvider | null;
  logsProvider: LogsPanelProvider | null;
  stateHub: StateHub | null;
  panelRouter: PanelRouter | null;
  mcpServer: HyperMcpServer | null;
  prepareDevServerTargetRef: (() => Promise<{ kind: 'ready' } | { kind: 'ambiguous'; targets: string[] }>) | null;
  rerootDevServerTargetRef: ((target: string) => Promise<void>) | null;
  getWorkspaceRoot: () => string | null;
}

export function registerCommands(context: vscode.ExtensionContext, workspaceRoot: string, ctx: CommandContext): void {
  const getCurrentRoot = () => ctx.getWorkspaceRoot() ?? workspaceRoot;
  // Open preview
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openPreview', () => {
      // ViewColumn.Two — see the auto-open comment above for why not ViewColumn.Beside.
      ctx.previewPanel?.createOrShow(vscode.ViewColumn.Two);
      // Sync current dev-server state into the just-created panel. The
      // hypercanvas.startDevServer command path calls setPreviewUrl(state.url)
      // when the dev server starts, but if the user opens the preview AFTER
      // the dev server is already running (e.g. e2e test order:
      // start dev server → Hyper: Open Preview), that initial setPreviewUrl
      // happened while previewPanel was null and was lost. Pull current state
      // here so the panel's iframe gets a URL on first paint.
      const state = ctx.devServerManager?.getState();
      if (state?.status === 'running' && state.url) {
        ctx.previewPanel?.setPreviewUrl(state.url);
      }
    }),
  );

  // Test/project-switch helper: open a folder in the current VS Code window
  // without relying on the external `code --reuse-window` process targeting the
  // correct Extension Development Host.
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openFolderPath', async (folderPath: string) => {
      if (typeof folderPath !== 'string' || folderPath.length === 0) return;
      await ctx.devServerManager?.stop();
      ctx.previewPanel?.dispose();
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath), false);
    }),
  );

  // Open Logs
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openLogs', () => {
      vscode.commands.executeCommand('hypercanvas.logsView.focus');
    }),
  );

  // Clear diagnostics
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.clearDiagnostics', () => {
      ctx.diagnosticHub?.clear();
    }),
  );

  // Open AI Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openAIChat', async () => {
      await ctx.aiChatProvider?.focusAndEnsureReady();
    }),
  );

  // Open Explorer panel
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openExplorer', () => {
      vscode.commands.executeCommand('hypercanvas.explorerView.focus');
    }),
  );

  // Open Inspector panel
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openInspector', async () => {
      await ctx.rightPanelProvider?.focusAndEnsureReady();
    }),
  );

  // Refresh preview
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.refreshPreview', () => {
      ctx.previewPanel?.refresh();
    }),
  );

  // Close preview panel (disposes the webview, clearing all iframe state)
  // AND reset every sidebar webview's HTML so React state (tree expand,
  // selection, click handlers, source-map caches in the preview iframe)
  // doesn't leak between tests. We used to also reset all sidebar
  // webviews here, but that wedged the AI Chat panel on the next test:
  // reset()'s html reassign on a HIDDEN webview (because the sidebar
  // was collapsed or pointing elsewhere at the moment closePreview ran)
  // left the webview with freshly-written HTML that never got a chance
  // to boot React — the next `Hyper: Open AI Chat` showed an empty
  // iframe and E2E polls for `hyper-aichat-root` timed out with
  // "Webviews: 0, available testIds: []". Leaving sidebar state alone
  // is fine: their React reducers are idempotent across mode switches,
  // and the per-test git checkout + command palette reopens give us
  // enough isolation for cross-test stability.
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.closePreview', async () => {
      ctx.previewPanel?.dispose();
    }),
  );

  // Canvas keybinding commands (VS Code intercepts keys before they reach the webview iframe)
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.canvasUndo', () => ctx.previewPanel?.undo()),
    vscode.commands.registerCommand('hypercanvas.canvasRedo', () => ctx.previewPanel?.redo()),
    vscode.commands.registerCommand('hypercanvas.canvasDelete', () => ctx.previewPanel?.deleteSelected()),
    vscode.commands.registerCommand('hypercanvas.canvasDuplicate', () => ctx.previewPanel?.duplicateSelected()),
    vscode.commands.registerCommand('hypercanvas.canvasGoToCode', () => ctx.previewPanel?.goToCodeSelected()),
    vscode.commands.registerCommand('hypercanvas.canvasWrap', () => ctx.previewPanel?.wrapSelected()),
    vscode.commands.registerCommand('hypercanvas.canvasInsertElement', () =>
      ctx.previewPanel?.openInsertPanelForSelection(),
    ),
    vscode.commands.registerCommand('hypercanvas.canvasSelectChildren', () => ctx.previewPanel?.selectChildren()),
    vscode.commands.registerCommand('hypercanvas.canvasSelectParent', () => ctx.previewPanel?.selectParent()),
    vscode.commands.registerCommand('hypercanvas.canvasSelectNextSibling', () => ctx.previewPanel?.selectNextSibling()),
    vscode.commands.registerCommand('hypercanvas.canvasSelectPrevSibling', () => ctx.previewPanel?.selectPrevSibling()),
    vscode.commands.registerCommand('hypercanvas.canvasEscape', () => ctx.previewPanel?.clearSelection()),
    vscode.commands.registerCommand('hypercanvas.selectElement', (elementId: string) => {
      ctx.previewPanel?.selectElement(elementId);
    }),
    vscode.commands.registerCommand('hypercanvas.selectElements', (elementIds: string[]) => {
      ctx.previewPanel?.selectElements(elementIds);
    }),
  );

  // Go to Visual - navigate from code to canvas
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.goToVisual', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const filePath = editor.document.uri.fsPath;
      if (!/\.(tsx|jsx)$/.test(filePath)) {
        vscode.window.showWarningMessage('Go to Visual only works in TSX/JSX files');
        return;
      }

      const position = editor.selection.active;
      const line = position.line + 1;
      const column = position.character + 1;

      const astService = new AstService(getCurrentRoot(), new VSCodeFileIO());
      const result = await astService.findElementAtPosition(filePath, line, column);

      if (result?.nodeRef) {
        ctx.previewPanel?.sendGoToVisual(result.nodeRef);
      } else {
        vscode.window.showWarningMessage('No element found at cursor position');
      }
    }),
  );

  // Start dev server
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.startDevServer', async () => {
      console.log('[HyperIDE] startDevServer command triggered');

      if (!ctx.devServerManager) {
        return;
      }

      // Monorepo-aware start (HYP-431): when opened at the repo root before any
      // component is selected, resolve a runnable sub-project target. One target →
      // re-root to it automatically; several → let the user pick which app to boot
      // rather than guessing (starting the wrong app is worse than asking).
      const prep = await ctx.prepareDevServerTargetRef?.();
      if (prep?.kind === 'ambiguous') {
        const repoRoot = getCurrentRoot();
        const picked = await vscode.window.showQuickPick(
          prep.targets.map((t) => ({ label: relative(repoRoot, t) || t, description: t, target: t })),
          {
            title: 'HyperIDE: Select a project to run',
            placeHolder: 'Multiple runnable projects found — choose which dev server to start',
          },
        );
        if (!picked) return; // user dismissed — don't start anything
        // Await the reroot before start() below — see rerootPreviewPipeline note on the race.
        await ctx.rerootDevServerTargetRef?.(picked.target);
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'HyperIDE: Starting dev server...',
          cancellable: false,
        },
        async () => {
          if (!ctx.devServerManager) return;
          const state = await ctx.devServerManager.start();
          console.log('[HyperIDE] Dev server state:', state.status, state.url);

          if (state.status === 'running') {
            vscode.window.showInformationMessage(`Dev server running at ${state.url}`);
            if (state.url) ctx.previewPanel?.setPreviewUrl(state.url);
          } else if (state.status === 'error') {
            vscode.window.showErrorMessage(`Failed to start dev server: ${state.error}`);
          }
        },
      );
    }),
  );

  // Stop dev server
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.stopDevServer', async () => {
      if (!ctx.devServerManager) {
        return;
      }

      await ctx.devServerManager.stop();
      vscode.window.showInformationMessage('Dev server stopped');
    }),
  );

  // Show dev server output
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.showDevServerOutput', () => {
      ctx.devServerManager?.showOutput();
    }),
  );

  // Fix unsupported project — installs react-native-web + Vite config for React Native / Tamagui projects
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.fixUnsupportedProject', async () => {
      const root = getCurrentRoot();
      const pkgManager = await detectPackageManager(root);
      const installCmd =
        pkgManager === 'bun'
          ? 'bun add'
          : pkgManager === 'yarn'
            ? 'yarn add'
            : pkgManager === 'pnpm'
              ? 'pnpm add'
              : 'npm install';
      const devInstallCmd =
        pkgManager === 'bun'
          ? 'bun add -d'
          : pkgManager === 'yarn'
            ? 'yarn add -D'
            : pkgManager === 'pnpm'
              ? 'pnpm add -D'
              : 'npm install -D';

      // Detect if this is a Next.js project
      let isNextJs = false;
      try {
        const pkgRaw = await readFile(join(root, 'package.json'), 'utf-8');
        const pkg = JSON.parse(pkgRaw);
        isNextJs = !!(pkg.dependencies?.next || pkg.devDependencies?.next);
      } catch {
        // Can't read package.json — fall through to Vite path
      }

      // Detect Tamagui One projects (use `one()` Vite plugin / `one dev`)
      let isTamaguiOne = false;
      if (!isNextJs) {
        try {
          const viteRaw = await readFile(join(root, 'vite.config.ts'), 'utf-8');
          isTamaguiOne =
            /\bone\s*\(/.test(viteRaw) || viteRaw.includes("from 'one/vite'") || viteRaw.includes('from "one/vite"');
        } catch {
          // No vite.config.ts — not a One project
        }
      }

      try {
        if (isNextJs) {
          // ── Next.js + Tamagui path ──
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `HyperIDE: Setting up react-native-web for Next.js via ${pkgManager}...`,
              cancellable: false,
            },
            async (progress) => {
              // Step 1: Install react-native-web as a dependency (no Vite needed)
              progress.report({ message: 'Installing react-native-web...' });
              await new Promise<void>((resolve, reject) => {
                const [cmd, ...args] = `${installCmd} react-native-web`.split(' ');
                execFile(cmd, args, { cwd: root, shell: process.platform === 'win32' }, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });

              // Step 2: Create or patch next.config
              progress.report({ message: 'Configuring Next.js for Tamagui...' });

              // Find existing next.config file (ts > mjs > js)
              const configVariants = ['next.config.ts', 'next.config.mjs', 'next.config.js'] as const;
              let existingConfigPath: string | null = null;
              let existingConfigContent = '';
              for (const variant of configVariants) {
                const candidate = join(root, variant);
                try {
                  existingConfigContent = await readFile(candidate, 'utf-8');
                  existingConfigPath = candidate;
                  break;
                } catch {
                  // Try next variant
                }
              }

              const targetConfigPath = existingConfigPath ?? join(root, 'next.config.ts');
              const isTypeScript = targetConfigPath.endsWith('.ts');

              // Check if config already has tamagui transpilePackages and turbo alias
              const hasTranspile =
                existingConfigContent.includes('react-native-web') &&
                existingConfigContent.includes('transpilePackages');
              const hasTurboAlias =
                existingConfigContent.includes('resolveAlias') && existingConfigContent.includes('react-native-web');

              if (!hasTranspile || !hasTurboAlias) {
                // Generate a fresh config — patching arbitrary user configs is fragile,
                // so we only overwrite if the critical pieces are missing.
                const configLines: string[] = [];
                if (isTypeScript) {
                  configLines.push("import type { NextConfig } from 'next';");
                  configLines.push('');
                  configLines.push('const nextConfig: NextConfig = {');
                } else {
                  configLines.push('/** @type {import("next").NextConfig} */');
                  configLines.push('const nextConfig = {');
                }
                configLines.push(
                  "  transpilePackages: ['react-native', 'react-native-web', 'tamagui', '@tamagui/config'],",
                );
                configLines.push('  experimental: {');
                configLines.push('    turbo: {');
                configLines.push('      resolveAlias: {');
                configLines.push("        'react-native': 'react-native-web',");
                configLines.push('      },');
                configLines.push('      resolveExtensions: [');
                configLines.push("        '.web.tsx',");
                configLines.push("        '.web.ts',");
                configLines.push("        '.web.jsx',");
                configLines.push("        '.web.js',");
                configLines.push("        '.tsx',");
                configLines.push("        '.ts',");
                configLines.push("        '.jsx',");
                configLines.push("        '.js',");
                configLines.push("        '.json',");
                configLines.push('      ],');
                configLines.push('    },');
                configLines.push('  },');
                configLines.push('};');
                configLines.push('');
                if (isTypeScript || targetConfigPath.endsWith('.mjs')) {
                  configLines.push('export default nextConfig;');
                } else {
                  configLines.push('module.exports = nextConfig;');
                }
                configLines.push('');
                await writeFile(targetConfigPath, configLines.join('\n'), 'utf-8');
              }
            },
          );
        } else if (isTamaguiOne) {
          // ── Tamagui One path — already has Vite via one(), just needs react-native-web ──
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `HyperIDE: Installing react-native-web for Tamagui One via ${pkgManager}...`,
              cancellable: false,
            },
            async (progress) => {
              progress.report({ message: 'Installing react-native-web...' });
              await new Promise<void>((resolve, reject) => {
                const [cmd, ...args] = `${installCmd} react-native-web`.split(' ');
                execFile(cmd, args, { cwd: root, shell: process.platform === 'win32' }, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
            },
          );
        } else {
          // ── Vite + Tamagui path (existing logic) ──
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `HyperIDE: Setting up react-native-web + Vite via ${pkgManager}...`,
              cancellable: false,
            },
            async (progress) => {
              // Step 1: Install react-native-web as a dependency
              progress.report({ message: 'Installing react-native-web...' });
              await new Promise<void>((resolve, reject) => {
                const [cmd, ...args] = `${installCmd} react-native-web`.split(' ');
                execFile(cmd, args, { cwd: root, shell: process.platform === 'win32' }, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });

              // Step 2: Install Vite toolchain as devDependencies
              progress.report({ message: 'Installing vite + plugins...' });
              await new Promise<void>((resolve, reject) => {
                const [cmd, ...args] = `${devInstallCmd} vite @vitejs/plugin-react @tamagui/vite-plugin`.split(' ');
                execFile(cmd, args, { cwd: root, shell: process.platform === 'win32' }, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });

              // Step 3: Create or patch vite.config.ts
              // If the file exists but doesn't have tamaguiPlugin / react-native-web
              // alias, overwrite it — a bare vite.config without these won't work
              // for Tamagui web builds.
              progress.report({ message: 'Configuring Vite for Tamagui...' });
              const viteConfigPath = join(root, 'vite.config.ts');
              let existingViteConfig = '';
              try {
                existingViteConfig = await readFile(viteConfigPath, 'utf-8');
              } catch {
                // File doesn't exist
              }
              // Never overwrite a Tamagui One vite config (uses one() plugin)
              const isOneConfig =
                /\bone\s*\(/.test(existingViteConfig) ||
                existingViteConfig.includes("from 'one/vite'") ||
                existingViteConfig.includes('from "one/vite"');
              const needsViteConfig =
                !isOneConfig &&
                (!existingViteConfig ||
                  !existingViteConfig.includes('tamaguiPlugin') ||
                  !existingViteConfig.includes('react-native-web'));
              if (needsViteConfig) {
                // Create stub files for deep react-native imports that rolldown can't resolve
                const stubsDir = join(root, 'src', 'stubs');
                await mkdir(stubsDir, { recursive: true });
                const codegenStub = join(stubsDir, 'codegenNativeComponent.ts');
                const appContainerStub = join(stubsDir, 'AppContainer.tsx');
                try {
                  await readFile(codegenStub);
                } catch {
                  await writeFile(
                    codegenStub,
                    'export default function codegenNativeComponent<P>(_name: string) {\n  return (_props: P) => null;\n}\n',
                    'utf-8',
                  );
                }
                try {
                  await readFile(appContainerStub);
                } catch {
                  await writeFile(
                    appContainerStub,
                    'import React from "react";\nexport default function AppContainer({ children }: { children: React.ReactNode }) {\n  return <>{children}</>;\n}\n',
                    'utf-8',
                  );
                }

                const viteConfigContent = [
                  "import path from 'path'",
                  "import { tamaguiPlugin } from '@tamagui/vite-plugin'",
                  "import react from '@vitejs/plugin-react'",
                  "import { defineConfig } from 'vite'",
                  '',
                  'export default defineConfig({',
                  '  plugins: [',
                  '    react(),',
                  '    tamaguiPlugin({',
                  "      components: ['tamagui'],",
                  '    }),',
                  '  ],',
                  '  resolve: {',
                  "    extensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],",
                  '    alias: {',
                  "      'react-native': 'react-native-web',",
                  "      'react-native/Libraries/Utilities/codegenNativeComponent': path.resolve(__dirname, 'src/stubs/codegenNativeComponent.ts'),",
                  "      'react-native/Libraries/ReactNative/AppContainer': path.resolve(__dirname, 'src/stubs/AppContainer.tsx'),",
                  '    },',
                  '  },',
                  '  optimizeDeps: {',
                  "    include: ['react-native-web', 'warn-once'],",
                  "    exclude: ['react-native-safe-area-context', 'react-native-screens'],",
                  '  },',
                  '})',
                  '',
                ].join('\n');
                await writeFile(viteConfigPath, viteConfigContent, 'utf-8');
              }

              // Step 4: Create index.html if it doesn't exist
              const indexHtmlPath = join(root, 'index.html');
              let indexHtmlExists = false;
              try {
                await readFile(indexHtmlPath);
                indexHtmlExists = true;
              } catch {
                // File doesn't exist — will create it
              }
              if (!indexHtmlExists) {
                const indexHtmlContent = [
                  '<!DOCTYPE html>',
                  '<html lang="en">',
                  '<head>',
                  '  <meta charset="UTF-8">',
                  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
                  '  <title>App</title>',
                  '</head>',
                  '<body>',
                  '  <div id="root"></div>',
                  '  <script type="module" src="/src/main.tsx"></script>',
                  '</body>',
                  '</html>',
                  '',
                ].join('\n');
                await writeFile(indexHtmlPath, indexHtmlContent, 'utf-8');
              }

              // Step 5: Update package.json scripts — set "dev": "vite" if currently using expo/metro
              progress.report({ message: 'Updating package.json scripts...' });
              try {
                const pkgJsonPath = join(root, 'package.json');
                const pkgRaw = await readFile(pkgJsonPath, 'utf-8');
                const pkg = JSON.parse(pkgRaw);
                const scripts = (pkg.scripts ?? {}) as Record<string, string>;
                const currentDev = scripts.dev ?? '';
                // Replace expo-based or missing dev script with vite
                // Never replace `one dev` — Tamagui One projects use their own Vite wrapper
                if ((!currentDev || currentDev.includes('expo')) && !currentDev.includes('one ')) {
                  scripts.dev = 'vite';
                  pkg.scripts = scripts;
                  await writeFile(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
                }
              } catch {
                // Non-critical — user can set the script manually
              }

              // Step 6: Create App.web.tsx — web entry without native navigation stack
              // Keeps SafeAreaProvider + NavigationContainer (both work on web via react-native-web)
              // but replaces native-stack navigator with direct screen render.
              progress.report({ message: 'Creating web entry point...' });
              try {
                const appPath = join(root, 'App.tsx');
                const appContent = await readFile(appPath, 'utf-8');
                const hasNativeImports = /expo-status-bar|@react-navigation\/native-stack|react-native-screens/.test(
                  appContent,
                );
                if (hasNativeImports) {
                  // Find tamagui config import
                  const cfgMatch = appContent.match(
                    /import\s+(?:\{\s*(\w+)\s*\}|(\w+))\s+from\s+['"]([^'"]*tamagui\.config[^'"]*)['"]/,
                  );
                  const cfgVar = cfgMatch?.[1] || cfgMatch?.[2] || 'config';
                  const cfgPath = cfgMatch?.[3] || './src/theme/tamagui.config';
                  const cfgIsNamed = !!cfgMatch?.[1];
                  // Find default theme
                  const themeMatch = appContent.match(/defaultTheme=["'](\w+)["']/);
                  const theme = themeMatch?.[1] || 'dark';

                  // Find first screen in src/screens/
                  let screenName = 'HomeScreen';
                  try {
                    const files = await readdir(join(root, 'src', 'screens'));
                    const home = files.find((f) => /^HomeScreen\.(tsx|jsx)$/.test(f));
                    const feed = files.find((f) => /^FeedScreen\.(tsx|jsx)$/.test(f));
                    const chat = files.find((f) => /^ChatListScreen\.(tsx|jsx)$/.test(f));
                    const any = files.find((f) => /Screen\.(tsx|jsx)$/.test(f));
                    const chosen = home || feed || chat || any;
                    if (chosen) screenName = chosen.replace(/\.(tsx|jsx)$/, '');
                  } catch {
                    /* no screens dir — use default */
                  }

                  // Check if screen uses useNavigation hook
                  let needsNavContainer = false;
                  try {
                    const screenSrc = await readFile(join(root, 'src', 'screens', `${screenName}.tsx`), 'utf-8');
                    needsNavContainer = /useNavigation\s*[<(]/.test(screenSrc);
                  } catch {
                    /* can't read screen — skip nav container */
                  }

                  // Detect extra context providers (e.g., CartProvider)
                  const extraProviders: Array<{ importLine: string; name: string }> = [];
                  const cartMatch = appContent.match(/import\s+\{\s*CartProvider\s*\}\s+from\s+['"]([^'"]+)['"]/);
                  if (cartMatch) {
                    extraProviders.push({
                      importLine: `import { CartProvider } from "${cartMatch[1]}";`,
                      name: 'CartProvider',
                    });
                  }

                  // Build App.web.tsx
                  const lines: string[] = [
                    'import React from "react";',
                    'import { TamaguiProvider } from "tamagui";',
                    'import { SafeAreaProvider } from "react-native-safe-area-context";',
                  ];
                  if (needsNavContainer) {
                    lines.push('import { NavigationContainer } from "@react-navigation/native";');
                  }
                  lines.push(
                    cfgIsNamed ? `import { ${cfgVar} } from "${cfgPath}";` : `import ${cfgVar} from "${cfgPath}";`,
                  );
                  for (const ep of extraProviders) lines.push(ep.importLine);
                  lines.push(`import { ${screenName} } from "./src/screens/${screenName}";`);
                  lines.push('');
                  lines.push('export default function App() {');
                  lines.push('  return (');

                  // Build provider nesting
                  let depth = 2;
                  const pad = (d: number) => '  '.repeat(d);
                  lines.push(`${pad(depth)}<SafeAreaProvider>`);
                  depth++;
                  if (needsNavContainer) {
                    lines.push(`${pad(depth)}<NavigationContainer>`);
                    depth++;
                  }
                  lines.push(`${pad(depth)}<TamaguiProvider config={${cfgVar}} defaultTheme="${theme}">`);
                  depth++;
                  for (const ep of extraProviders) {
                    lines.push(`${pad(depth)}<${ep.name}>`);
                    depth++;
                  }
                  lines.push(`${pad(depth)}<${screenName} />`);
                  for (const ep of [...extraProviders].reverse()) {
                    depth--;
                    lines.push(`${pad(depth)}</${ep.name}>`);
                  }
                  depth--;
                  lines.push(`${pad(depth)}</TamaguiProvider>`);
                  if (needsNavContainer) {
                    depth--;
                    lines.push(`${pad(depth)}</NavigationContainer>`);
                  }
                  depth--;
                  lines.push(`${pad(depth)}</SafeAreaProvider>`);
                  lines.push('  );');
                  lines.push('}');
                  lines.push('');

                  await writeFile(join(root, 'App.web.tsx'), lines.join('\n'), 'utf-8');
                }
              } catch {
                // App.tsx doesn't exist or can't be read — skip
              }
            },
          );
        }
        // Re-check to confirm the package was recorded in package.json
        const stillUnsupported = await detectUnsupportedProject(root);
        if (stillUnsupported) {
          vscode.window.showWarningMessage(
            'HyperIDE: react-native-web may not have been added to package.json. Try running the install manually.',
          );
        } else {
          const successMsg = isNextJs
            ? 'react-native-web + Next.js configured. Run "dev" to start the Next.js dev server.'
            : isTamaguiOne
              ? 'react-native-web installed. Restart `one dev` to apply.'
              : 'react-native-web + Vite configured. Run "dev" to start the Vite dev server.';
          vscode.window.showInformationMessage(successMsg);
          ctx.previewPanel?.notifyUnsupportedProject(null);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`HyperIDE: Failed to set up project: ${msg}`);
      }
    }),
  );

  // Configure AI API key — multi-step wizard
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.configureAIKey', async () => {
      // ── Step 1: Choose provider ──
      const config = vscode.workspace.getConfiguration('hypercanvas.ai');
      const currentProvider = config.get<string>('provider', 'glm') as AIProvider;
      const plansLine = GLM_RECOMMENDATION.plans.map((p) => `${p.name} ${p.price}`).join(' \u00b7 ');

      interface ProviderItem extends vscode.QuickPickItem {
        providerId: AIProvider | 'settings';
      }

      const providerItems: ProviderItem[] = [
        {
          label: `$(star-full) ${PROVIDER_LABELS.glm}`,
          detail: `${GLM_RECOMMENDATION.description} ${plansLine}`,
          description: currentProvider === 'glm' ? 'current' : '',
          providerId: 'glm',
        },
        {
          label: PROVIDER_LABELS.firepass,
          detail: `${FIREPASS_INFO.description} ${FIREPASS_INFO.plans[0].price}`,
          description: currentProvider === 'firepass' ? 'current' : '',
          providerId: 'firepass',
        },
        {
          label: PROVIDER_LABELS.claude,
          detail: 'Per-token pricing via Anthropic API',
          description: currentProvider === 'claude' ? 'current' : '',
          providerId: 'claude',
        },
        {
          label: PROVIDER_LABELS.openai,
          detail: 'GPT-4o and OpenAI-compatible APIs',
          description: currentProvider === 'openai' ? 'current' : '',
          providerId: 'openai',
        },
        {
          label: '$(gear) Other providers (Gemini, DeepSeek, Mistral, Qwen...)',
          detail: 'Opens AI Settings to pick provider, model, and backend',
          providerId: 'settings',
        },
      ];

      const pickedProvider = await vscode.window.showQuickPick(providerItems, {
        title: 'Hyper: Configure AI (Step 1/2) — Choose Provider',
        placeHolder: 'Which AI provider do you want to use?',
      });

      if (!pickedProvider) return;

      if (pickedProvider.providerId === 'settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'hypercanvas.ai');
        return;
      }

      const selectedProvider = pickedProvider.providerId;
      const defaults = AI_PROVIDER_DEFAULTS[selectedProvider];
      const providerLabel = PROVIDER_LABELS[selectedProvider];

      // Apply provider + defaults to settings
      if (selectedProvider !== currentProvider) {
        await config.update('provider', selectedProvider, vscode.ConfigurationTarget.Global);
        await config.update('model', defaults.model, vscode.ConfigurationTarget.Global);
        await config.update('baseURL', defaults.baseURL ?? undefined, vscode.ConfigurationTarget.Global);
      }

      // ── Step 2: Enter key or get one ──
      const keyUrl = PROVIDER_KEY_URLS[selectedProvider];

      interface ActionItem extends vscode.QuickPickItem {
        action: 'enter' | 'get-key';
      }

      const actionItems: ActionItem[] = [
        {
          label: `$(key) Enter API key for ${providerLabel}`,
          detail: `model=${defaults.model}`,
          action: 'enter',
        },
      ];

      if (keyUrl) {
        actionItems.push({
          label: `$(link-external) Get API key from ${keyUrl.label}`,
          detail: keyUrl.url,
          action: 'get-key',
        });
      }

      const pickedAction = await vscode.window.showQuickPick(actionItems, {
        title: 'Hyper: Configure AI (Step 2/2) — API Key',
        placeHolder: `Provider: ${providerLabel}`,
      });

      if (!pickedAction) return;

      if (pickedAction.action === 'get-key' && keyUrl) {
        vscode.env.openExternal(vscode.Uri.parse(keyUrl.url));
        return;
      }

      // ── Input key ──
      const key = await vscode.window.showInputBox({
        title: `${providerLabel} API Key`,
        prompt: `Enter ${providerLabel} API key (will be stored in OS keychain)`,
        password: true,
      });

      if (key !== undefined) {
        if (key) {
          await context.secrets.store('hypercanvas.ai.apiKey', key);
          vscode.window.showInformationMessage(`${providerLabel} API key saved.`);
        } else {
          await context.secrets.delete('hypercanvas.ai.apiKey');
          vscode.window.showInformationMessage('AI API key removed.');
        }
      }
    }),
  );

  // Open/create project structure config file
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openProjectStructure', async () => {
      const configDir = vscode.Uri.joinPath(vscode.Uri.file(getCurrentRoot()), '.hyperide');
      const configFile = vscode.Uri.joinPath(configDir, 'project-structure.json');

      try {
        await vscode.workspace.fs.stat(configFile);
      } catch {
        // File doesn't exist — create with template
        await vscode.workspace.fs.createDirectory(configDir);

        const template = {
          '.atomComponentsPaths': 'Paths to directories with atomic/base UI components (buttons, inputs, etc.)',
          atomComponentsPaths: [] as string[],
          '.compositeComponentsPaths': 'Paths to directories with composite components (forms, cards, layouts)',
          compositeComponentsPaths: [] as string[],
          '.pagesPaths': 'Paths to directories with page components (Next.js pages, route components)',
          pagesPaths: [] as string[],
        };

        const content = Buffer.from(JSON.stringify(template, null, 2), 'utf-8');
        await vscode.workspace.fs.writeFile(configFile, content);
      }

      const doc = await vscode.workspace.openTextDocument(configFile);
      await vscode.window.showTextDocument(doc);
    }),
  );

  // Setup MCP for AI agents (Copilot, Claude Code, Codex, OpenCode)
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.setupMcp', async () => {
      if (!ctx.mcpServer || ctx.mcpServer.port === 0) {
        vscode.window.showErrorMessage('HyperCanvas MCP server is not running');
        return;
      }

      // Step 1: Choose AI agents — pre-check already configured ones
      interface AgentItem extends vscode.QuickPickItem {
        agentId: 'copilot' | 'claude-code' | 'codex' | 'opencode';
      }

      const configured = await detectConfiguredAgents(getCurrentRoot());

      const agents: AgentItem[] = [
        {
          label: 'VS Code Copilot',
          detail: 'Write .vscode/mcp.json — auto-discovered by GitHub Copilot',
          agentId: 'copilot',
          picked: configured.copilot,
        },
        {
          label: 'Claude Code',
          detail: 'Write .mcp.json — auto-discovered by Claude Code CLI',
          agentId: 'claude-code',
          picked: configured.claudeCode,
        },
        {
          label: 'Codex',
          detail: 'Write .codex/config.toml — auto-discovered by OpenAI Codex CLI',
          agentId: 'codex',
          picked: configured.codex,
        },
        {
          label: 'OpenCode',
          detail: 'Write opencode.json — auto-discovered by OpenCode CLI',
          agentId: 'opencode',
          picked: configured.opencode,
        },
      ];

      const picked = await vscode.window.showQuickPick(agents, {
        title: 'Hyper: Setup MCP (Step 1/2) — Choose AI Agents',
        placeHolder: 'Select AI agents to configure (multi-select)',
        canPickMany: true,
      });

      if (!picked || picked.length === 0) return;

      const url = ctx.mcpServer.url;

      const configRoot = getCurrentRoot();
      for (const agent of picked) {
        if (agent.agentId === 'copilot') {
          await writeVsCodeMcpJson(configRoot, url);
        } else if (agent.agentId === 'claude-code') {
          await writeMcpJson(configRoot, url);
        } else if (agent.agentId === 'codex') {
          await writeCodexConfig(configRoot, url);
        } else if (agent.agentId === 'opencode') {
          await writeOpenCodeJson(configRoot, url);
        }
      }

      // Step 2: Companion MCP servers
      interface CompanionItem extends vscode.QuickPickItem {
        companionId: string;
        npxPackage: string;
      }

      const companions: CompanionItem[] = [
        {
          label: 'Playwright MCP',
          detail: 'Browser automation & visual testing — take screenshots, click elements, fill forms',
          companionId: 'playwright',
          npxPackage: '@playwright/mcp@latest',
        },
        {
          label: 'Serena MCP',
          detail: 'Semantic code navigation & refactoring — find symbols, references, rename across codebase',
          companionId: 'serena',
          npxPackage: '@anthropic/serena-mcp@latest',
        },
        {
          label: 'Context7 MCP',
          detail: 'Up-to-date library docs — pulls latest API references for any npm/pip package',
          companionId: 'context7',
          npxPackage: '@upstash/context7-mcp@latest',
        },
      ];

      const pickedCompanions = await vscode.window.showQuickPick(companions, {
        title: 'Hyper: Setup MCP (Step 2/2) — Companion Servers',
        placeHolder: 'These MCP servers work great alongside HyperCanvas (optional)',
        canPickMany: true,
      });

      // Detect browser for Playwright before building configs
      let playwrightExtraArgs: string[] = [];
      const playwrightPicked = (pickedCompanions ?? []).some((c) => c.companionId === 'playwright');
      if (playwrightPicked) {
        const detection = detectBrowserForPlaywright();
        if (detection.found) {
          playwrightExtraArgs = detection.extraArgs;
        } else {
          try {
            await installChromeForPlaywright();
          } catch {
            // Error already shown to user, continue with config writing
          }
        }
      }

      // Write companion servers into the same config files selected in step 1
      const companionConfigs = (pickedCompanions ?? []).map((c) => ({
        id: c.companionId,
        command: 'npx',
        args: ['-y', c.npxPackage, ...(c.companionId === 'playwright' ? playwrightExtraArgs : [])],
      }));

      const agentIds = picked.map((a) => a.agentId);

      if (companionConfigs.length > 0) {
        await writeCompanionServers(configRoot, agentIds, companionConfigs);
      }

      const allNames = [...picked.map((a) => a.label), ...(pickedCompanions ?? []).map((c) => c.label)];
      vscode.window.showInformationMessage(`MCP configured: ${allNames.join(', ')}`);
    }),
  );
}

/**
 * Auto-update existing MCP config files with the new port.
 * Called on every extension activation to keep port in sync.
 */
