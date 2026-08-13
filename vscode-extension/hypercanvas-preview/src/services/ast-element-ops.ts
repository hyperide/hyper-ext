/**
 * Element insertion, duplication, and paste operations for AstService.
 * Extracted as standalone functions to reduce AstService.ts size.
 */

import * as t from '@babel/types';
import type { NodeRef } from '@shared/element-tracing/types';
import { buildJSXElement } from '@lib/ast/element-builder';
import { ensureImport } from '@lib/ast/import-manager';
import { duplicateElementInAST, insertElementIntoAST, parseTSXElements, wrapElementInAST } from '@lib/ast/operations';

import { resolveWorkspacePath } from './workspace-path';
import type { FindElementResult } from '@lib/types';

export interface ElementOpsDeps {
  workspaceRoot: string;
  fileParser: {
    readAndParseFile(filePath: string): Promise<{ ast: t.File }>;
    writeAST(ast: t.File, filePath: string): Promise<void>;
    readFileContent(filePath: string): Promise<string>;
  };
  updateNodeMap: (filePath: string) => Promise<void>;
  // Follows a nodeRef into the file it actually lives in (a child component, not the open
  // entry). Element-ops resolve through this so a cross-file selection mutates + writes the
  // child AST/path instead of searching the wrong (entry) file and reporting "not found".
  resolveElementInCorrectFile: (
    absolutePath: string,
    nodeRef: NodeRef,
  ) => Promise<{ result: FindElementResult; ast: t.File; resolvedPath: string } | null>;
}

/**
 * Read a file's content before a mutation so the AstBridge undo layer can snapshot the
 * pre-write state for cross-file writes. Returns undefined on read failure — AstBridge
 * then skips the undo snapshot rather than recording an empty string (which would erase
 * the file on undo). Same rationale as updateI18nKey's contentBeforeWrite capture.
 */
async function readContentBeforeWrite(deps: ElementOpsDeps, filePath: string): Promise<string | undefined> {
  try {
    return await deps.fileParser.readFileContent(filePath);
  } catch {
    return undefined;
  }
}

/**
 * The undo-tracking fields AstBridge reads to snapshot a cross-file write. Only emitted
 * when the mutation landed in a different file than the requested one — for same-file
 * writes AstBridge already has the pre-write content, and omitting the fields keeps the
 * existing same-file return shape (`{ success: true }`) untouched.
 *
 * The caller owns the single "is this cross-file" decision (`resolvedPath !== absolutePath`)
 * and passes it in as `isCrossFile`, so the same boolean gates both the contentBeforeWrite
 * read and this field emission — the check is never re-derived here.
 */
function crossFileWriteFields(
  isCrossFile: boolean,
  resolvedPath: string,
  contentBeforeWrite: string | undefined,
): { resolvedPath: string; contentBeforeWrite?: string } | Record<string, never> {
  if (!isCrossFile) return {};
  return { resolvedPath, contentBeforeWrite };
}

export type InsertElementResult =
  | {
      success: true;
      index?: number;
      resolvedPath?: string;
      contentBeforeWrite?: string;
    }
  | {
      success: false;
      error: string;
    };

export async function insertElement(
  deps: ElementOpsDeps,
  filePath: string,
  parentId: string | null,
  componentType: string,
  props: Record<string, unknown>,
  index?: number,
  _targetId?: string,
  componentFilePath?: string,
  parentNodeRef?: NodeRef,
): Promise<InsertElementResult> {
  try {
    const absolutePath = resolveWorkspacePath(deps.workspaceRoot, filePath);

    // Production wires the parent's source-location nodeRef through `parentId` (the dedicated
    // `parentNodeRef` slot is never populated by the AstBridge handler). So treat `parentId`
    // as the cross-file pointer when no explicit `parentNodeRef` was given, mirroring the
    // `nodeRef ?? elementId` pattern used by duplicate/wrap. `parentNodeRef` still wins when
    // present (future-proofing).
    const effectiveParentRef = parentNodeRef ?? (parentId ? (parentId as NodeRef) : undefined);

    // Resolve the parent into the file it lives in. When the parent is in a child
    // component, the insert + import injection must happen in (and write to) that child
    // AST, not the open entry. Cross-file resolution is purely ADDITIVE: an unresolvable
    // ref (or a legacy non-nodeRef `parentId` like "root-1") leaves `resolved` null and
    // falls through to a root insert into the open entry below — preserving the documented
    // contract (`ast-service-insert.test.ts`: "insert goes to root level regardless of
    // parentId"). Hard-failing here would break that contract.
    const resolved = effectiveParentRef
      ? await deps.resolveElementInCorrectFile(absolutePath, effectiveParentRef)
      : null;
    const targetAst = resolved?.ast ?? (await deps.fileParser.readAndParseFile(absolutePath)).ast;
    const targetPath = resolved?.resolvedPath ?? absolutePath;
    const isCrossFile = targetPath !== absolutePath;
    const contentBeforeWrite = isCrossFile ? await readContentBeforeWrite(deps, targetPath) : undefined;

    const { element: newElement } = buildJSXElement({ componentType, props });

    if (/^[A-Z]/.test(componentType)) {
      ensureImport(targetAst, {
        componentName: componentType,
        targetFilePath: targetPath,
        componentFilePath,
        workspaceRoot: deps.workspaceRoot,
      });
    }

    const { inserted, actualIndex } = insertElementIntoAST(targetAst, {
      parent: resolved?.result ?? null,
      newElement,
      logicalIndex: index,
    });

    if (!inserted) {
      return {
        success: false,
        error: parentId ? `Parent element not found in ${filePath}` : 'Could not find return statement with JSX',
      };
    }

    await deps.fileParser.writeAST(targetAst, targetPath);
    await deps.updateNodeMap(targetPath);
    return { success: true, index: actualIndex, ...crossFileWriteFields(isCrossFile, targetPath, contentBeforeWrite) };
  } catch (error) {
    console.error('[insertElement] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export type DuplicateElementResult =
  | {
      success: true;
      newId?: string;
      resolvedPath?: string;
      contentBeforeWrite?: string;
    }
  | {
      success: false;
      error: string;
    };

export async function duplicateElement(
  deps: ElementOpsDeps,
  filePath: string,
  elementId: string,
  nodeRef?: NodeRef,
): Promise<DuplicateElementResult> {
  try {
    const effectiveNodeRef = (nodeRef ?? elementId) as NodeRef;
    const absolutePath = resolveWorkspacePath(deps.workspaceRoot, filePath);

    // duplicateElementInAST mutates the AST that result.path belongs to, so resolving via
    // resolveElementInCorrectFile makes a cross-file duplicate land in the child AST/path.
    const resolved = await deps.resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
    if (!resolved) {
      return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
    }
    const { result, ast, resolvedPath } = resolved;
    const isCrossFile = resolvedPath !== absolutePath;
    const contentBeforeWrite = isCrossFile ? await readContentBeforeWrite(deps, resolvedPath) : undefined;

    const { inserted } = duplicateElementInAST(result);

    if (!inserted) {
      return { success: false, error: 'Could not duplicate element (parent is not a JSX element or fragment)' };
    }

    await deps.fileParser.writeAST(ast, resolvedPath);
    await deps.updateNodeMap(resolvedPath);
    return { success: true, ...crossFileWriteFields(isCrossFile, resolvedPath, contentBeforeWrite) };
  } catch (error) {
    console.error('[duplicateElement] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function pasteElement(
  deps: ElementOpsDeps,
  filePath: string,
  _targetId: string | null,
  tsxCode: string,
  targetNodeRef?: NodeRef,
): Promise<InsertElementResult> {
  try {
    const absolutePath = resolveWorkspacePath(deps.workspaceRoot, filePath);

    const { elements: newElements } = parseTSXElements(tsxCode);

    if (newElements.length === 0) {
      return { success: false, error: 'No valid JSX elements in clipboard' };
    }

    // Production wires the target's source-location nodeRef through `_targetId` (the dedicated
    // `targetNodeRef` slot is never populated by the AstBridge handler). So treat `_targetId`
    // as the cross-file pointer when no explicit `targetNodeRef` was given, mirroring the
    // `nodeRef ?? elementId` pattern used by duplicate/wrap. `targetNodeRef` still wins when
    // present (future-proofing).
    const effectiveTargetRef = targetNodeRef ?? (_targetId ? (_targetId as NodeRef) : null);

    // Resolve the paste target into the file it lives in so a paste next to a cross-file
    // element mutates + writes that child AST/path. On a target miss (or no target) we fall
    // back to a root insert into the open entry file.
    const resolved = effectiveTargetRef
      ? await deps.resolveElementInCorrectFile(absolutePath, effectiveTargetRef)
      : null;
    const targetAst = resolved?.ast ?? (await deps.fileParser.readAndParseFile(absolutePath)).ast;
    const targetPath = resolved?.resolvedPath ?? absolutePath;
    const isCrossFile = targetPath !== absolutePath;
    const contentBeforeWrite = isCrossFile ? await readContentBeforeWrite(deps, targetPath) : undefined;

    let inserted = insertAfterTarget(resolved?.result ?? null, newElements);

    if (!inserted) {
      // Root fallback. When the target resolved cross-file (`targetAst`/`targetPath` are the
      // child's), this intentionally lands the paste at the root of that same resolved child
      // file — not the open entry — because the user's selection lives in the child. The
      // crossFileWriteFields/undo snapshot below is keyed off the same resolved targetPath, so
      // the write target stays consistent with where the content lands.
      inserted = insertAtRoot(targetAst, newElements);
    }

    if (!inserted) {
      return { success: false, error: 'Could not find insertion point' };
    }

    await deps.fileParser.writeAST(targetAst, targetPath);
    await deps.updateNodeMap(targetPath);
    return { success: true, ...crossFileWriteFields(isCrossFile, targetPath, contentBeforeWrite) };
  } catch (error) {
    console.error('[pasteElement] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** Insert pasted elements directly after the resolved target within its JSX parent. */
function insertAfterTarget(result: FindElementResult | null, newElements: t.JSXElement[]): boolean {
  if (!result) return false;
  const parent = result.path.parent;
  if (!t.isJSXElement(parent)) return false;
  const children = parent.children;
  const idx = children.indexOf(result.path.node);
  if (idx === -1) return false;
  children.splice(idx + 1, 0, ...newElements);
  return true;
}

/** Fallback: insert pasted elements into the JSX return root of the given AST. */
function insertAtRoot(ast: t.File, newElements: t.JSXElement[]): boolean {
  const rootResult = insertElementIntoAST(ast, { parent: null, newElement: newElements[0] });
  if (!rootResult.inserted) return false;
  for (let i = 1; i < newElements.length; i++) {
    insertElementIntoAST(ast, { parent: null, newElement: newElements[i] });
  }
  return true;
}

export type WrapElementResult =
  | {
      success: true;
      resolvedPath?: string;
      contentBeforeWrite?: string;
    }
  | {
      success: false;
      error: string;
    };

export async function wrapElement(
  deps: ElementOpsDeps,
  filePath: string,
  elementId: string,
  wrapperType: string,
  wrapperProps?: Record<string, unknown>,
  nodeRef?: NodeRef,
): Promise<WrapElementResult> {
  try {
    const absolutePath = resolveWorkspacePath(deps.workspaceRoot, filePath);
    const effectiveNodeRef = (nodeRef ?? elementId) as NodeRef;

    // wrapElementInAST replaces result.path in place, so resolving via
    // resolveElementInCorrectFile makes a cross-file wrap land in the child AST/path.
    const resolved = await deps.resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
    if (!resolved) {
      return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
    }
    const { result, ast, resolvedPath } = resolved;
    const isCrossFile = resolvedPath !== absolutePath;
    const contentBeforeWrite = isCrossFile ? await readContentBeforeWrite(deps, resolvedPath) : undefined;

    const { wrapped } = wrapElementInAST(result, wrapperType, wrapperProps);

    if (!wrapped) {
      return { success: false, error: 'Could not wrap element' };
    }

    await deps.fileParser.writeAST(ast, resolvedPath);
    await deps.updateNodeMap(resolvedPath);
    return { success: true, ...crossFileWriteFields(isCrossFile, resolvedPath, contentBeforeWrite) };
  } catch (error) {
    console.error('[wrapElement] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
