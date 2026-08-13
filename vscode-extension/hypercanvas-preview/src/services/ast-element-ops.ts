/**
 * Element insertion, duplication, and paste operations for AstService.
 * Extracted as standalone functions to reduce AstService.ts size.
 */

import * as t from '@babel/types';
import type { NodeRef } from '@shared/element-tracing/types';
import { buildJSXElement } from '@lib/ast/element-builder';
import { ensureImport } from '@lib/ast/import-manager';
import { duplicateElementInAST, insertElementIntoAST, parseTSXElements } from '@lib/ast/operations';

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
  resolveElement: (ast: t.File, nodeRef: NodeRef, filePath?: string) => FindElementResult | null;
}

export type InsertElementResult =
  | {
      success: true;
      index?: number;
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
    const { ast } = await deps.fileParser.readAndParseFile(absolutePath);

    const { element: newElement } = buildJSXElement({ componentType, props });

    if (/^[A-Z]/.test(componentType)) {
      ensureImport(ast, {
        componentName: componentType,
        targetFilePath: absolutePath,
        componentFilePath,
        workspaceRoot: deps.workspaceRoot,
      });
    }

    const parentResult = parentNodeRef ? deps.resolveElement(ast, parentNodeRef, absolutePath) : null;

    const { inserted, actualIndex } = insertElementIntoAST(ast, {
      parent: parentResult,
      newElement,
      logicalIndex: index,
    });

    if (!inserted) {
      return {
        success: false,
        error: parentId ? `Parent element not found in ${filePath}` : 'Could not find return statement with JSX',
      };
    }

    await deps.fileParser.writeAST(ast, absolutePath);
    await deps.updateNodeMap(absolutePath);
    return { success: true, index: actualIndex };
  } catch (error) {
    console.error('[insertElement] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export type DuplicateElementResult =
  | {
      success: true;
      newId?: string;
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
    const effectiveNodeRef = nodeRef ?? elementId;
    const absolutePath = resolveWorkspacePath(deps.workspaceRoot, filePath);

    const { ast } = await deps.fileParser.readAndParseFile(absolutePath);
    const result = deps.resolveElement(ast, effectiveNodeRef as NodeRef, absolutePath);
    if (!result) {
      return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
    }

    const { inserted } = duplicateElementInAST(result);

    if (!inserted) {
      return { success: false, error: 'Could not duplicate element (parent is not a JSX element or fragment)' };
    }

    await deps.fileParser.writeAST(ast, absolutePath);
    await deps.updateNodeMap(absolutePath);
    return { success: true };
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
    const { ast } = await deps.fileParser.readAndParseFile(absolutePath);

    const { elements: newElements } = parseTSXElements(tsxCode);

    if (newElements.length === 0) {
      return { success: false, error: 'No valid JSX elements in clipboard' };
    }

    let inserted = false;

    if (targetNodeRef) {
      const result = deps.resolveElement(ast, targetNodeRef, absolutePath);
      if (result) {
        const parent = result.path.parent;
        if (t.isJSXElement(parent)) {
          const children = parent.children;
          const idx = children.indexOf(result.path.node);
          if (idx !== -1) {
            children.splice(idx + 1, 0, ...newElements);
            inserted = true;
          }
        }
      }
    }

    if (!inserted) {
      const rootResult = insertElementIntoAST(ast, { parent: null, newElement: newElements[0] });
      if (rootResult.inserted) {
        for (let i = 1; i < newElements.length; i++) {
          insertElementIntoAST(ast, { parent: null, newElement: newElements[i] });
        }
        inserted = true;
      }
    }

    if (!inserted) {
      return { success: false, error: 'Could not find insertion point' };
    }

    await deps.fileParser.writeAST(ast, absolutePath);
    await deps.updateNodeMap(absolutePath);
    return { success: true };
  } catch (error) {
    console.error('[pasteElement] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export type WrapElementResult =
  | {
      success: true;
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
    const effectiveNodeRef = nodeRef ?? (elementId as NodeRef);

    const { ast } = await deps.fileParser.readAndParseFile(absolutePath);
    const result = deps.resolveElement(ast, effectiveNodeRef as NodeRef, absolutePath);
    if (!result) {
      return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
    }

    const { wrapElementInAST } = await import('@lib/ast/operations');
    const { wrapped } = wrapElementInAST(result, wrapperType, wrapperProps);

    if (!wrapped) {
      return { success: false, error: 'Could not wrap element' };
    }

    await deps.fileParser.writeAST(ast, absolutePath);
    await deps.updateNodeMap(absolutePath);
    return { success: true };
  } catch (error) {
    console.error('[wrapElement] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
