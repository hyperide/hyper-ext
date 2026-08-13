/**
 * AST update utilities — style and prop updates.
 */

import * as t from '@babel/types';
import { executeStyleWriteRequest } from '@lib/style-write/style-write-executor';
import { runStyleWriteTransaction } from '@lib/style-write/transaction/index.node';
import { isJsxSourceFile } from './ast-utils';
import type { ColorProbeCandidate } from './color-probe-types';
import type { NodeRef } from '@shared/element-tracing/types';
import type { FileIO } from '@lib/ast/file-io';
import { resolveWorkspacePath } from './workspace-path';
import type { FindElementResult } from '@lib/types';

export interface UpdateStylesDeps {
  workspaceRoot: string;
  fileIO: FileIO;
  resolveElementInCorrectFile: (
    absolutePath: string,
    nodeRef: NodeRef,
  ) => Promise<{ result: FindElementResult; ast: t.File; resolvedPath: string } | null>;
  updateNodeMap: (filePath: string) => Promise<void>;
  /** HYP-544 Phase 3 — ranked driving candidates from the empirical color-probe (unresolvable case). */
  probeDriving?: ColorProbeCandidate[];
}

export async function updateStyles(
  filePath: string,
  elementId: string,
  styles: Record<string, string>,
  state: string | undefined,
  nodeRef: NodeRef | undefined,
  selectedSourceTabId: string | undefined,
  domClasses: string | undefined,
  deps: UpdateStylesDeps,
): Promise<
  { success: true; resolvedPath: string; contentBeforeWrite: string | undefined } | { success: false; error: string }
> {
  const absolutePath = resolveWorkspacePath(deps.workspaceRoot, filePath);
  const effectiveNodeRef = nodeRef ?? (elementId as NodeRef);

  const resolved = await deps.resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
  if (!resolved) {
    return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
  }
  const { result, ast, resolvedPath } = resolved;

  let contentBeforeWrite: string | undefined;
  if (resolvedPath !== absolutePath) {
    try {
      contentBeforeWrite = await deps.fileIO.readFile(resolvedPath);
    } catch {}
  }

  // B0 write transaction (spec §9.1, HYP-722 T1a): passes the VS Code workspace FileIO as
  // baseFileIO so the transaction snapshots and rolls back through the same transport the executor
  // uses for the actual write. fileIO must NOT appear in request — the transaction injects its own
  // SnapshotFileIO (wrapping baseFileIO) into the execute call so every read/write goes through it.
  const writeResult = await runStyleWriteTransaction({
    execute: executeStyleWriteRequest,
    baseFileIO: deps.fileIO,
    request: {
      ast,
      sourceFilePath: resolvedPath,
      element: result.element,
      styles,
      state,
      selectedSourceTabId,
      domClasses,
      probeDriving: deps.probeDriving,
      runtimeThemeContext: {
        ideThemePreference: 'system',
        resolvedColorScheme: 'light',
        source: 'vscode',
      },
      projectRoot: deps.workspaceRoot,
    },
  });
  if (writeResult.success === false) return { success: false, error: writeResult.error };

  for (const mutatedFile of writeResult.mutatedFiles) {
    if (isJsxSourceFile(mutatedFile)) {
      await deps.updateNodeMap(mutatedFile);
    }
  }
  return { success: true, resolvedPath, contentBeforeWrite };
}
