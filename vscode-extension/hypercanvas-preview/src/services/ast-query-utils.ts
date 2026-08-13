/**
 * AST query utilities for AstService.
 * Read-only operations that resolve element info without mutating the AST.
 */

import * as t from '@babel/types';
import type { NodeRef } from '@shared/element-tracing/types';
import { extractElementSource } from '@lib/ast/operations';
import { findElementAtPosition as findElementAtPositionInAST } from '@lib/ast/traverser';
import type { NodeMapService } from '@lib/element-tracing/node-map-service';
import { resolveWorkspacePath } from './workspace-path';
import type { FindElementResult } from '@lib/types';

export interface QueryDeps {
  workspaceRoot: string;
  fileParser: {
    readAndParseFile(filePath: string): Promise<{ ast: t.File }>;
    readFileContent(filePath: string): Promise<string>;
  };
  nodeMapService: NodeMapService;
  resolveElement: (ast: t.File, nodeRef: NodeRef, filePath?: string) => FindElementResult | null;
  resolveNodeMapEntry: (nodeRef: NodeRef) => { parentRef: string | null; children: string[]; nodeRef: string } | null;
  normalizeNodeRef: (nodeRef: NodeRef) => string;
}

export async function findElementAtPosition(
  deps: QueryDeps,
  filePath: string,
  line: number,
  column: number,
): Promise<{ tagName: string; nodeRef?: NodeRef } | null> {
  try {
    const absolutePath = resolveWorkspacePath(deps.workspaceRoot, filePath);
    const { ast } = await deps.fileParser.readAndParseFile(absolutePath);
    const result = findElementAtPositionInAST(ast, line, column);
    if (!result) return null;

    const nameNode = result.element.openingElement.name;
    const tagName = t.isJSXIdentifier(nameNode) ? nameNode.name : 'unknown';

    const sourceLocation = { fileName: absolutePath, line, column: column - 1 };
    const entry = deps.nodeMapService.resolveSourceLocation(sourceLocation);

    // Go-to-visual sends this nodeRef to the iframe, which resolves it against its fiber
    // source index keyed by `fileName:line:column` (`parseSourceRef`). The node map's own
    // `entry.nodeRef` is the builder's synthetic `filePath:counter` form — `parseSourceRef`
    // returns null for it, so go-to-visual silently resolved nothing. Return a SOURCE-LOCATION
    // ref built from `entry.loc` (project-relative path, source line/column) so the iframe's
    // exact / closest-line fallback can find the rendered element. (go-to-visual fix)
    const sourceRef = entry ? (`${entry.loc.fileName}:${entry.loc.line}:${entry.loc.column}` as NodeRef) : undefined;

    return {
      tagName,
      ...(sourceRef ? { nodeRef: sourceRef } : {}),
    };
  } catch (error) {
    console.warn('[findElementAtPosition] parse failed (expected for broken/partial files):', error);
    return null;
  }
}

export async function getElementLocation(
  deps: QueryDeps,
  _filePath: string,
  _elementId: string,
  nodeRef?: NodeRef,
): Promise<{ line: number; column: number } | null> {
  try {
    if (nodeRef) {
      const entry = deps.nodeMapService.resolveNodeRef(nodeRef);
      if (entry) {
        return { line: entry.loc.line, column: entry.loc.column };
      }
    }
    return null;
  } catch (error) {
    console.error('[getElementLocation] Error:', error);
    return null;
  }
}

export async function getElementCode(
  deps: QueryDeps,
  filePath: string,
  elementId: string,
  nodeRef?: NodeRef,
): Promise<string | null> {
  try {
    const absolutePath = resolveWorkspacePath(deps.workspaceRoot, filePath);
    const effectiveNodeRef = nodeRef ?? (elementId as NodeRef);
    const sourceCode = await deps.fileParser.readFileContent(absolutePath);
    const { ast } = await deps.fileParser.readAndParseFile(absolutePath);

    const result = deps.resolveElement(ast, effectiveNodeRef, absolutePath);
    if (!result) return null;

    return extractElementSource(sourceCode, result.element);
  } catch (error) {
    console.error('[getElementCode] Error:', error);
    return null;
  }
}

export async function getParentElementId(
  deps: QueryDeps,
  _filePath: string,
  _elementId: string,
  nodeRef?: NodeRef,
): Promise<string | null> {
  try {
    if (nodeRef) {
      const entry = deps.resolveNodeMapEntry(nodeRef);
      if (entry?.parentRef) {
        return entry.parentRef;
      }
    }
    return null;
  } catch (error) {
    console.error('[getParentElementId] Error:', error);
    return null;
  }
}

export async function getChildElementIds(deps: QueryDeps, nodeRef?: NodeRef): Promise<string[]> {
  try {
    if (nodeRef) {
      const entry = deps.resolveNodeMapEntry(nodeRef);
      if (entry) {
        return [...entry.children];
      }
    }
    return [];
  } catch (error) {
    console.error('[getChildElementIds] Error:', error);
    return [];
  }
}

export async function getSiblingElementId(
  deps: QueryDeps,
  _filePath: string,
  _elementId: string,
  direction: 'next' | 'prev',
  nodeRef?: NodeRef,
): Promise<string | null> {
  try {
    if (nodeRef) {
      const entry = deps.resolveNodeMapEntry(nodeRef);
      if (entry?.parentRef) {
        const parent = deps.nodeMapService.resolveNodeRef(entry.parentRef);
        if (parent) {
          const siblings = parent.children;
          let currentIndex = siblings.indexOf(entry.nodeRef);
          if (currentIndex === -1) {
            const normalizedRef = deps.normalizeNodeRef(nodeRef);
            const m = normalizedRef.match(/^(.+):(\d+):(\d+)$/);
            if (m) {
              const [, file, line] = m;
              currentIndex = siblings.findIndex((s) => {
                const sm = s.match(/^(.+):(\d+):(\d+)$/);
                return sm && sm[1] === file && sm[2] === line;
              });
            }
          }
          if (currentIndex !== -1) {
            let targetIndex: number;
            if (direction === 'prev') {
              targetIndex = currentIndex === 0 ? siblings.length - 1 : currentIndex - 1;
            } else {
              targetIndex = currentIndex === siblings.length - 1 ? 0 : currentIndex + 1;
            }
            return siblings[targetIndex] ?? null;
          }
        }
      }
    }
    return null;
  } catch (error) {
    console.error('[getSiblingElementId] Error:', error);
    return null;
  }
}
