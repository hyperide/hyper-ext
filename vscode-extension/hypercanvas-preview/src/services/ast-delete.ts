import type { NodeRef } from '@shared/element-tracing/types';
import { resolveWorkspacePath } from './workspace-path';
import type { AstOperationResult } from './ast-types';
import type { FileIO } from '@lib/ast/file-io';
import type { createFileParser } from '@lib/ast/parser';
import type { File } from '@babel/types';

export interface DeleteElementsDeps {
  fileIO: FileIO;
  fileParser: ReturnType<typeof createFileParser>;
  updateNodeMap: (filePath: string) => Promise<void>;
  resolveElementInCorrectFile: (
    absolutePath: string,
    nodeRef: NodeRef,
  ) => Promise<{
    result: { path: { remove: () => void } };
    ast: File;
    resolvedPath: string;
  } | null>;
}

export async function deleteElements(
  filePath: string,
  elementIds: string[],
  workspaceRoot: string,
  deps: DeleteElementsDeps,
): Promise<AstOperationResult> {
  const absolutePath = resolveWorkspacePath(workspaceRoot, filePath);
  let deletedCount = 0;

  const contentBeforeByPath = new Map<string, string>();

  for (const id of elementIds) {
    const resolved = await deps.resolveElementInCorrectFile(absolutePath, id as NodeRef);

    if (!resolved) {
      console.log(
        `[AstService.deleteElements] Element ${id.substring(0, 8)} not found (may have been deleted as child)`,
      );
      continue;
    }

    const { result, ast, resolvedPath } = resolved;

    if (resolvedPath !== absolutePath && !contentBeforeByPath.has(resolvedPath)) {
      try {
        contentBeforeByPath.set(resolvedPath, await deps.fileIO.readFile(resolvedPath));
      } catch {
        // Leave unset
      }
    }

    result.path.remove();
    await deps.fileParser.writeAST(ast, resolvedPath);
    await deps.updateNodeMap(resolvedPath);
    deletedCount++;
  }

  if (deletedCount === 0) {
    return { success: false, error: 'No elements found with provided IDs' };
  }

  const allCrossFileSnapshots =
    contentBeforeByPath.size > 0
      ? Array.from(contentBeforeByPath.entries()).map(([rp, cb]) => ({ resolvedPath: rp, contentBefore: cb }))
      : undefined;
  return {
    success: true,
    data: { deletedCount },
    allCrossFileSnapshots,
  };
}
