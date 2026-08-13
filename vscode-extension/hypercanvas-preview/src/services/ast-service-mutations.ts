/**
 * AstService mutation wrappers — thin delegates to the extracted operation modules.
 * Keeping these in a separate file reduces AstService.ts to its core
 * (initialization, resolution, and cross-file move logic).
 */

import type * as t from '@babel/types';
import type { NodeRef } from '@shared/element-tracing/types';
import type { CssSystemId } from '@lib/style-read/types';
import type { FileIO } from '@lib/ast/file-io';
import type { ColorProbeCandidate } from './color-probe-types';
import { mutateElement } from './ast-mutation-utils';
import { deleteElements } from './ast-delete';
import { updateStyles } from './ast-update-utils';
import { setAttribute, updateElementChildren, valueToJSXAttribute } from '@lib/ast/mutator';
import type { AstOperationResult, UpdateStylesResult, UpdateTextResult } from './ast-types';
import type { FindElementResult } from '@lib/types';

export interface MutationWrapperDeps {
  workspaceRoot: string;
  fileIO: FileIO;
  fileParser: {
    readAndParseFile(filePath: string): Promise<{ ast: t.File; absolutePath: string }>;
    writeAST(ast: t.File, filePath: string): Promise<void>;
    readFileContent(filePath: string): Promise<string>;
    invalidate(filePath: string): void;
    invalidateAll(): void;
  };
  updateNodeMap: (filePath: string) => Promise<void>;
  resolveElementInCorrectFile: (
    absolutePath: string,
    nodeRef: NodeRef,
  ) => Promise<{ result: FindElementResult; ast: t.File; resolvedPath: string } | null>;
  resolveElement: (ast: t.File, nodeRef: NodeRef, filePath?: string) => FindElementResult | null;
  /**
   * UIKit-derived project default CSS system (a Tailwind project → 'tailwind-v4'). Threaded to the
   * shared style-write executor so a surfaceless element floors to the project system, never a silent
   * inline `style={{}}` (D2 §4.3, parity with the SaaS batch route).
   */
  projectDefaultCssSystem?: CssSystemId;
  /** HYP-901 — tsconfig path-alias map lookup for the non-forwarding-component pre-write check. */
  getAliasMap?: (importerFilePath: string) => Record<string, string>;
  /** HYP-901 — B1-lite runtime computed-style verify for the auto-wrap retry candidate. */
  verifyComputedStyle?: (elementId: string, cssProperties: string[]) => Promise<Record<string, string> | null>;
}

export async function updateStylesWrapper(
  deps: MutationWrapperDeps,
  filePath: string,
  elementId: string,
  styles: Record<string, string>,
  state: string | undefined,
  nodeRef: NodeRef | undefined,
  selectedSourceTabId: string | undefined,
  domClasses: string | undefined,
  probeDriving: ColorProbeCandidate[] | undefined,
  verifyElementId?: string,
): Promise<UpdateStylesResult> {
  try {
    const result = await updateStyles(filePath, elementId, styles, state, nodeRef, selectedSourceTabId, domClasses, {
      workspaceRoot: deps.workspaceRoot,
      fileIO: deps.fileIO,
      resolveElementInCorrectFile: (absolutePath, nr) => deps.resolveElementInCorrectFile(absolutePath, nr),
      updateNodeMap: (fp) => deps.updateNodeMap(fp),
      probeDriving,
      projectDefaultCssSystem: deps.projectDefaultCssSystem,
      getAliasMap: deps.getAliasMap,
      verifyComputedStyle: deps.verifyComputedStyle,
      verifyElementId,
    });
    return result;
  } catch (error) {
    console.error('[updateStylesWrapper] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function updatePropsWrapper(
  deps: MutationWrapperDeps,
  filePath: string,
  elementId: string,
  props: Record<string, unknown>,
  nodeRef?: NodeRef,
): Promise<AstOperationResult> {
  try {
    const result = await mutateElement(
      {
        workspaceRoot: deps.workspaceRoot,
        fileIO: deps.fileIO,
        fileParser: deps.fileParser,
        updateNodeMap: deps.updateNodeMap,
        resolveElementInCorrectFile: deps.resolveElementInCorrectFile,
      },
      filePath,
      elementId,
      nodeRef,
      (res) => {
        for (const [propName, propValue] of Object.entries(props)) {
          setAttribute(res.element, propName, valueToJSXAttribute(propValue));
        }
      },
    );
    return result;
  } catch (error) {
    console.error('[updatePropsWrapper] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function updateTextWrapper(
  deps: MutationWrapperDeps,
  filePath: string,
  elementId: string,
  text: string,
  nodeRef?: NodeRef,
): Promise<UpdateTextResult> {
  try {
    const result = await mutateElement(
      {
        workspaceRoot: deps.workspaceRoot,
        fileIO: deps.fileIO,
        fileParser: deps.fileParser,
        updateNodeMap: deps.updateNodeMap,
        resolveElementInCorrectFile: deps.resolveElementInCorrectFile,
      },
      filePath,
      elementId,
      nodeRef,
      (res) => {
        updateElementChildren(res.element, text);
      },
    );
    if (!result.success) return result;

    const openingLoc = result.result.element.openingElement?.loc?.start ?? result.result.element.loc?.start;
    const newLocation =
      openingLoc !== undefined && openingLoc !== null
        ? { line: openingLoc.line, column: openingLoc.column }
        : undefined;
    return { ...result, newLocation };
  } catch (error) {
    console.error('[updateTextWrapper] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function deleteElementsWrapper(
  deps: MutationWrapperDeps,
  filePath: string,
  elementIds: string[],
): Promise<AstOperationResult> {
  try {
    return await deleteElements(filePath, elementIds, deps.workspaceRoot, {
      fileIO: deps.fileIO,
      fileParser: deps.fileParser,
      updateNodeMap: (fp) => deps.updateNodeMap(fp),
      resolveElementInCorrectFile: (ap, nr) => deps.resolveElementInCorrectFile(ap, nr),
    });
  } catch (error) {
    console.error('[deleteElementsWrapper] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
