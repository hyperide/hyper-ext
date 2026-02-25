/**
 * StyleReadService - reads raw className and element metadata from AST
 *
 * Used by the Right Panel (Inspector) to get element style data
 * without needing iframe DOM access. Reads file -> parses AST ->
 * finds element by data-uniq-id -> extracts className, childrenType, etc.
 */

import { parseCode } from '@lib/ast/parser';
import {
  findElementByUuid,
  analyzeJSXChildren,
  getChildrenLocation,
  getJSXTagName,
} from '@lib/ast/traverser';
import {
  getAttributeString,
} from '@lib/ast/mutator';
import type { FileIO } from '@lib/ast/file-io';

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

  constructor(workspaceRoot: string, fileIO: FileIO) {
    this._workspaceRoot = workspaceRoot;
    this._fileIO = fileIO;
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
   * Read className and metadata from an element in the AST
   */
  async readElementClassName(
    elementId: string,
    componentPath: string,
  ): Promise<StyleReadResult> {
    const absolutePath = this._resolvePath(componentPath);

    try {
      const content = await this._fileIO.readFile(absolutePath);
      const ast = parseCode(content);

      const result = findElementByUuid(ast, elementId);
      if (!result) {
        return {
          className: '',
          childrenType: undefined,
          textContent: '',
          tagType: 'unknown',
        };
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
      return {
        className: '',
        childrenType: undefined,
        textContent: '',
        tagType: 'unknown',
      };
    }
  }

}
