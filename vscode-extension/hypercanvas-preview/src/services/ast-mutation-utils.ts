/**
 * AST mutation utilities for AstService.
 * Shared helpers for common mutation patterns (resolve, mutate, write, update node map).
 */

import type { FileIO } from '@lib/ast/file-io';
import type { FindElementResult } from '@lib/types';
import type { NodeRef } from '@shared/element-tracing/types';
import { resolveWorkspacePath } from './workspace-path';

export interface AstMutationDeps {
  workspaceRoot: string;
  fileIO: FileIO;
  fileParser: {
    readAndParseFile(filePath: string): Promise<{ ast: import('@babel/types').File }>;
    writeAST(ast: import('@babel/types').File, filePath: string): Promise<void>;
    readFileContent(filePath: string): Promise<string>;
  };
  updateNodeMap: (filePath: string) => Promise<void>;
  resolveElementInCorrectFile: (
    absolutePath: string,
    nodeRef: NodeRef,
  ) => Promise<{ result: FindElementResult; ast: import('@babel/types').File; resolvedPath: string } | null>;
}

interface MutationResult {
  success: true;
  result: FindElementResult;
  resolvedPath: string;
  contentBeforeWrite?: string;
  [key: string]: unknown;
}

interface MutationError {
  success: false;
  error: string;
}

export type MutationOutcome = MutationResult | MutationError;

async function resolveAndPrepare(
  deps: AstMutationDeps,
  filePath: string,
  elementId: string,
  nodeRef?: NodeRef,
): Promise<
  | {
      result: FindElementResult;
      ast: import('@babel/types').File;
      resolvedPath: string;
      absolutePath: string;
      contentBeforeWrite: string | undefined;
    }
  | MutationError
> {
  const absolutePath = resolveWorkspacePath(deps.workspaceRoot, filePath);
  const effectiveNodeRef = nodeRef ?? (elementId as NodeRef);

  const resolved = await deps.resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
  if (!resolved) {
    return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
  }

  let contentBeforeWrite: string | undefined;
  if (resolved.resolvedPath !== absolutePath) {
    try {
      contentBeforeWrite = await deps.fileIO.readFile(resolved.resolvedPath);
    } catch {}
  }

  return { ...resolved, absolutePath, contentBeforeWrite };
}

async function finalizeMutation(
  deps: AstMutationDeps,
  result: FindElementResult,
  ast: import('@babel/types').File,
  resolvedPath: string,
  contentBeforeWrite: string | undefined,
): Promise<MutationResult> {
  await deps.fileParser.writeAST(ast, resolvedPath);
  await deps.updateNodeMap(resolvedPath);
  return { success: true, result, resolvedPath, contentBeforeWrite };
}

export async function mutateElement(
  deps: AstMutationDeps,
  filePath: string,
  elementId: string,
  nodeRef: NodeRef | undefined,
  mutate: (result: FindElementResult, ast: import('@babel/types').File) => void | Promise<void>,
): Promise<MutationOutcome> {
  const prep = await resolveAndPrepare(deps, filePath, elementId, nodeRef);
  if ('error' in prep) return prep;

  await mutate(prep.result, prep.ast);
  return finalizeMutation(deps, prep.result, prep.ast, prep.resolvedPath, prep.contentBeforeWrite);
}
