/**
 * Preview panel error handler — creates sample scaffolds from error boundary UI.
 * Extracted to reduce PreviewPanel.ts size.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureSample } from '@lib/preview-generator';
import { createExtensionSampleGenerator } from './services/SampleAIGenerator';
import { VSCodeFileIO } from './vscode-file-io';
import { extractComponentName } from '../../../lib/preview-generator/scanner';
import { escapeRegex } from '../../../lib/preview-generator/scanner';
import { deriveSubProjectPrefix, resolveComponentAbsPath, toRepoRelativePath } from './bridges/monorepo-path-translate';
import type { PanelRouter } from './PanelRouter';
import type { StateHub } from './StateHub';

export interface ErrorHandlerDeps {
  currentComponent: string | undefined;
  previewComponent: string | undefined;
  workspaceRoot: string;
  onSampleCreatedCallback: ((repoRelativePath: string) => Promise<void>) | undefined;
  buildPropEntries: (propValues?: Record<string, unknown>) => Array<[string, unknown]>;
  buildSampleScaffold: (
    componentName: string,
    exportName: string,
    propEntries: Array<[string, unknown]>,
    sourceCode: string,
  ) => string;
  panel: vscode.WebviewPanel | undefined;
  stateHub: StateHub;
  watchSampleInFile: (absPath: string, exportName: string, webview: vscode.Webview) => void;
  panelRouter: PanelRouter;
  context: vscode.ExtensionContext;
}

export async function handleCreateSampleFromError(
  deps: ErrorHandlerDeps,
  componentPath: string | undefined,
  propValues?: Record<string, unknown>,
  sampleName?: string,
  options?: {
    componentName?: string;
    notifySampleCreated?: boolean;
    revealInEditor?: boolean;
    suggestAIKey?: boolean;
  },
): Promise<boolean> {
  if (!componentPath) return false;

  const subProjectPrefix = deriveSubProjectPrefix(deps.currentComponent, deps.previewComponent);
  const absPath = resolveComponentAbsPath(componentPath, deps.workspaceRoot, subProjectPrefix);
  const repoRelativePath = toRepoRelativePath(componentPath, subProjectPrefix);
  const exportName = sampleName || 'SampleDefault';
  const revealInEditor = options?.revealInEditor ?? true;
  const notifySampleCreated = options?.notifySampleCreated ?? true;

  let sourceCode: string;
  try {
    const fileUri = vscode.Uri.file(absPath);
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    sourceCode = Buffer.from(bytes).toString('utf-8');
  } catch {
    void vscode.window.showErrorMessage(`Could not read component file: ${componentPath}`);
    return false;
  }

  const fileName = path.basename(absPath, path.extname(absPath));
  const componentName = options?.componentName ?? extractComponentName(sourceCode, fileName);

  const existingRegex = new RegExp(`export\\s+const\\s+${escapeRegex(exportName)}\\s*=`); // nosemgrep: detect-non-literal-regexp -- exportName is escaped internal identifier, not user input
  // Use the regex match position (not a literal indexOf) so nonstandard
  // whitespace like `export  const Sample` can't desync the detected start
  // from the existence check above (indexOf would return -1 and corrupt the
  // replacement slices below).
  const existingMatch = existingRegex.exec(sourceCode);
  if (existingMatch) {
    const exportStart = existingMatch.index;
    const afterSample = sourceCode.slice(exportStart);
    const nextExportMatch = afterSample.match(/\n(export\s)/);
    const sampleEnd = nextExportMatch ? exportStart + (nextExportMatch.index ?? afterSample.length) : sourceCode.length;
    // HYP-870: the replacement scaffold re-adds its own `// Sample component
    // for preview` header, so the comment line(s) sitting directly above the
    // existing sample must be consumed by the replacement range too. Keeping
    // them in the retained prefix duplicated the comment on every rewrite
    // (observed live: 8 stacked copies in conloca-app's AccountPage.tsx).
    // Blank lines between stacked copies are consumed as well.
    const scaffoldCommentAbove = sourceCode
      .slice(0, exportStart)
      .match(/(?:[ \t]*\/\/ Sample component for preview[ \t]*\r?\n(?:[ \t]*\r?\n)*)+$/);
    const sampleStart = scaffoldCommentAbove ? exportStart - scaffoldCommentAbove[0].length : exportStart;

    const propEntries = deps.buildPropEntries(propValues);
    const replacement = deps.buildSampleScaffold(componentName, exportName, propEntries, sourceCode);

    sourceCode = sourceCode.slice(0, sampleStart) + replacement.trimStart() + sourceCode.slice(sampleEnd);

    try {
      const fileUri = vscode.Uri.file(absPath);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(sourceCode, 'utf-8'));
    } catch {
      void vscode.window.showErrorMessage(`Could not write to component file: ${componentPath}`);
      return false;
    }

    if (notifySampleCreated) {
      await deps.onSampleCreatedCallback?.(repoRelativePath);
    }

    if (!revealInEditor) {
      return true;
    }

    const lineNumber = sourceCode.substring(0, sourceCode.indexOf(exportName)).split('\n').length;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
      preview: true,
      selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0),
    });
    return true;
  }

  const hasPropValues = propValues && Object.keys(propValues).length > 0;
  let sampleWrittenByAI = false;

  if (!hasPropValues) {
    const propDefs = await deps.panelRouter.componentService
      ?.getComponentDefinitions(repoRelativePath)
      .catch(() => null);
    const hasRequiredProps = propDefs?.some((p) => p.required) ?? false;

    if (hasRequiredProps) {
      const apiKey = await deps.context.secrets.get('hypercanvas.ai.apiKey');
      if (apiKey) {
        const aiGenerated = await ensureSample({
          io: new VSCodeFileIO(),
          absolutePath: absPath,
          componentName,
          sampleName: exportName,
          generate: createExtensionSampleGenerator(deps.context),
        });
        if (aiGenerated.exists) {
          sampleWrittenByAI = true;
        } else {
          return false;
        }
      } else {
        if (options?.suggestAIKey) {
          const action = await vscode.window.showInformationMessage(
            `"${componentName}" has required props. Configure an AI key to auto-fill them.`,
            'Configure AI Key',
          );
          if (action === 'Configure AI Key') {
            void vscode.commands.executeCommand('hypercanvas.configureAIKey');
          }
        }
        return false;
      }
    }
  }

  let updatedCode: string | undefined;
  if (!sampleWrittenByAI) {
    const propEntries = deps.buildPropEntries(propValues);
    const scaffold = deps.buildSampleScaffold(componentName, exportName, propEntries, sourceCode);
    updatedCode = `${sourceCode}\n${scaffold}\n`;
    try {
      const fileUri = vscode.Uri.file(absPath);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedCode, 'utf-8'));
    } catch {
      void vscode.window.showErrorMessage(`Could not write to component file: ${componentPath}`);
      return false;
    }
    console.log(`[HyperIDE] Created ${exportName} scaffold in ${componentPath}`);
  }

  if (revealInEditor) {
    const codeToSearch =
      updatedCode ?? Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(absPath))).toString('utf-8');
    const lines = codeToSearch.split('\n');
    const todoIdx = lines.findIndex((line) => line.includes('// TODO: Add required props'));
    const sampleIdx = lines.findIndex((line) => line.includes(exportName));
    const targetLine = todoIdx >= 0 ? todoIdx : Math.max(sampleIdx, 0);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
      preview: true,
      selection: new vscode.Range(targetLine, 0, targetLine, 0),
    });
  }

  if (deps.panel) {
    deps.watchSampleInFile(absPath, exportName, deps.panel.webview);
  }
  if (notifySampleCreated) {
    await deps.onSampleCreatedCallback?.(repoRelativePath);
  }
  return true;
}
