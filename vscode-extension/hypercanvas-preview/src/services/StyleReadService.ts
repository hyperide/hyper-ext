/**
 * StyleReadService - reads raw className and element metadata from AST
 *
 * Used by the Right Panel (Inspector) to get element style data
 * without needing iframe DOM access. Reads file -> parses AST ->
 * finds element by position (via NodeMapService) -> extracts className, childrenType, etc.
 */

import type { FileIO } from '@lib/ast/file-io';
import { getAttributeString } from '@lib/ast/mutator';
import { parseCode } from '@lib/ast/parser';
import { findElementByPosition } from '@lib/ast/position-finder';
import { analyzeJSXChildren, getChildrenLocation, getJSXTagName } from '@lib/ast/traverser';
import type { NodeMapService } from '@lib/element-tracing/node-map-service';
import type { NodeRef } from '@shared/element-tracing/types';

export interface StyleReadResult {
  className: string;
  childrenType: 'text' | 'expression' | 'expression-complex' | 'jsx' | undefined;
  textContent: string;
  tagType: string;
  childrenLocation?: { line: number; column: number };
}

export class StyleReadService {
  private _workspaceRoot: string;
  private _fileIO: FileIO;
  private _nodeMapService: NodeMapService;

  constructor(workspaceRoot: string, fileIO: FileIO, nodeMapService: NodeMapService) {
    this._workspaceRoot = workspaceRoot;
    this._fileIO = fileIO;
    this._nodeMapService = nodeMapService;
  }

  /**
   * Resolve file path to absolute path
   */
  private _resolvePath(filePath: string): string {
    if (filePath.startsWith('/')) {
      return filePath;
    }
    return `${this._workspaceRoot}/${filePath}`;
  }

  /**
   * Read className and metadata from an element in the AST.
   * Uses nodeRef (preferred) to resolve element by position.
   */
  async readElementClassName(_elementId: string, componentPath: string, nodeRef?: NodeRef): Promise<StyleReadResult> {
    const absolutePath = this._resolvePath(componentPath);
    const empty: StyleReadResult = {
      className: '',
      childrenType: undefined,
      textContent: '',
      tagType: 'unknown',
    };

    try {
      if (!nodeRef) return empty;

      // Prefer lookup by real nodeRef (UUID from NodeMapService).
      // Fall back to resolving a syntheticRef (format: "fileName:line:column") via source location —
      // this is the format used by React 19 fiber-based refs where paths are relative Vite URLs.
      let entry = this._nodeMapService.resolveNodeRef(nodeRef);

      // Track parsed syntheticRef values for direct position lookup if NodeMapService is empty
      let directLine: number | null = null;
      let directColumn: number | null = null;
      let directPath: string | null = null;

      if (!entry) {
        const m = nodeRef.match(/^(.+):(\d+):(\d+)$/);
        if (m) {
          directLine = Number.parseInt(m[2], 10);
          directColumn = Number.parseInt(m[3], 10);
          directPath = this._resolvePath(m[1]);
          entry = this._nodeMapService.resolveSourceLocation({
            fileName: m[1],
            line: directLine,
            column: directColumn,
          });
        }
      }

      const searchLine = entry?.loc.line ?? directLine;
      const searchColumn = entry?.loc.column ?? directColumn;
      // NodeMapService empty and no syntheticRef — nothing to resolve
      if (searchLine === null || searchColumn === null) {
        console.warn('[HyperCanvas] Selection lost after HMR — element not found for nodeRef:', nodeRef);
        return empty;
      }

      const filePath = directPath ?? absolutePath;
      const content = await this._fileIO.readFile(filePath);
      const ast = parseCode(content);

      const result = findElementByPosition(ast, searchLine, searchColumn);
      if (!result) {
        console.warn(
          `[HyperCanvas] Selection lost after HMR — AST element not found at ${searchLine}:${searchColumn} for nodeRef:`,
          nodeRef,
        );
        return empty;
      }

      const element = result.element;

      // Extract className
      const className = getAttributeString(element, 'className') || '';

      // Extract tag type
      const tagName = getJSXTagName(element);

      // Analyze children to determine childrenType and textContent
      const { childrenType, textContent } = analyzeJSXChildren(element);

      // Get children location for "Go to code" navigation
      const childrenLoc = getChildrenLocation(element);

      return {
        className,
        childrenType,
        textContent,
        tagType: tagName,
        childrenLocation: childrenLoc || undefined,
      };
    } catch (error) {
      console.error('[StyleReadService] Error reading element className:', error);
      return empty;
    }
  }
}
