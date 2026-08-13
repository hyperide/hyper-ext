import { describe, expect, it, mock } from 'bun:test';
import type { ASTNode } from '../../canvas-engine/types/ast';
import {
  findAstNodeBySourceLoc,
  getElementLocByUuid,
  resolveIdsToUuids,
  resolveNodeRefToUuid,
  resolveUuidToNodeRef,
} from '../id-bridge';

// Mock active tracer
const mockGetSourceByNodeRef = mock();
const mockBuildSourceKeyIndex = mock();
const mockTracer = {
  getSourceByNodeRef: mockGetSourceByNodeRef,
  buildSourceKeyIndex: mockBuildSourceKeyIndex,
};

mock.module('../active-tracer', () => ({
  getActiveTracer: () => mockTracer,
}));

// --------------------------------------------------------------------------
// Test fixtures
// --------------------------------------------------------------------------

const AST_TREE: ASTNode[] = [
  {
    id: 'uuid-div-1',
    type: 'div',
    loc: { start: { line: 5, column: 4 }, end: { line: 10, column: 10 } },
    children: [
      {
        id: 'uuid-span-1',
        type: 'span',
        loc: { start: { line: 6, column: 6 }, end: { line: 6, column: 20 } },
      },
      {
        id: 'uuid-button-1',
        type: 'Button',
        loc: { start: { line: 7, column: 6 }, end: { line: 7, column: 30 } },
      },
    ],
  },
];

const mockEngine = {
  getRoot: () => ({
    metadata: { sampleStructure: AST_TREE },
    children: [],
  }),
  getInstance: () => null,
};

// --------------------------------------------------------------------------
// findAstNodeBySourceLoc
// --------------------------------------------------------------------------

describe('findAstNodeBySourceLoc', () => {
  it('should find root-level node by line:column', () => {
    const node = findAstNodeBySourceLoc(AST_TREE, 5, 4);
    expect(node?.id).toBe('uuid-div-1');
  });

  it('should find nested node by line:column', () => {
    const node = findAstNodeBySourceLoc(AST_TREE, 6, 6);
    expect(node?.id).toBe('uuid-span-1');
  });

  it('should return null for non-matching location', () => {
    const node = findAstNodeBySourceLoc(AST_TREE, 99, 99);
    expect(node).toBeNull();
  });

  it('should handle nodes without loc', () => {
    const noLocTree: ASTNode[] = [{ id: 'no-loc', type: 'div' }];
    const node = findAstNodeBySourceLoc(noLocTree, 1, 0);
    expect(node).toBeNull();
  });
});

// --------------------------------------------------------------------------
// resolveNodeRefToUuid
// --------------------------------------------------------------------------

describe('resolveNodeRefToUuid', () => {
  it('should resolve nodeRef to UUID via source location', () => {
    mockGetSourceByNodeRef.mockReturnValueOnce({ fileName: 'src/App.tsx', line: 6, column: 6 });

    const result = resolveNodeRefToUuid('src/App.tsx:1', mockEngine as never);
    expect(result).toBe('uuid-span-1');
  });

  it('should return original id when nodeRef not found in tracer', () => {
    mockGetSourceByNodeRef.mockReturnValueOnce(null);

    const result = resolveNodeRefToUuid('unknown-ref', mockEngine as never);
    expect(result).toBe('unknown-ref');
  });

  it('should return original id when source location has no matching AST node', () => {
    mockGetSourceByNodeRef.mockReturnValueOnce({ fileName: 'src/App.tsx', line: 99, column: 99 });

    const result = resolveNodeRefToUuid('src/App.tsx:99', mockEngine as never);
    expect(result).toBe('src/App.tsx:99');
  });
});

// --------------------------------------------------------------------------
// resolveUuidToNodeRef
// --------------------------------------------------------------------------

describe('resolveUuidToNodeRef', () => {
  it('should resolve UUID to nodeRef via source location', () => {
    mockBuildSourceKeyIndex.mockReturnValueOnce(
      new Map([
        ['src/App.tsx:7:6', { nodeRef: 'src/App.tsx:2', source: { fileName: 'src/App.tsx', line: 7, column: 6 } }],
      ]),
    );

    const result = resolveUuidToNodeRef('uuid-button-1', mockEngine as never);
    expect(result).toBe('src/App.tsx:2');
  });

  // Live-stand repro (HYP-594): src/App.tsx h1 and src/components/Hero.tsx h1 both sit
  // at the same line:column, and the positional scan returned whichever file's node map
  // arrived first (src/App.tsx) — so tree-selecting the rendered component's h1 queried
  // a file with no fibers in the preview and the outline never drew. The entry from the
  // currently rendered file must win.
  it('prefers the rendered file when several files share line:column (cross-file collision)', () => {
    const tracerWithRenderedFile = mockTracer as { renderedFile?: string | null; makeSourceKey?: unknown };
    tracerWithRenderedFile.renderedFile = 'src/components/Hero.tsx';
    tracerWithRenderedFile.makeSourceKey = (s: { fileName: string; line: number; column: number }) =>
      `${s.fileName}:${s.line}:${s.column}`;
    mockBuildSourceKeyIndex.mockReturnValueOnce(
      new Map([
        ['src/App.tsx:7:6', { nodeRef: 'src/App.tsx:1', source: { fileName: 'src/App.tsx', line: 7, column: 6 } }],
        [
          'src/components/Hero.tsx:7:6',
          { nodeRef: 'src/components/Hero.tsx:2', source: { fileName: 'src/components/Hero.tsx', line: 7, column: 6 } },
        ],
      ]),
    );
    try {
      const result = resolveUuidToNodeRef('uuid-button-1', mockEngine as never);
      expect(result).toBe('src/components/Hero.tsx:2');
    } finally {
      tracerWithRenderedFile.renderedFile = null;
      delete tracerWithRenderedFile.makeSourceKey;
    }
  });

  it('falls back to the positional scan when the rendered file has no entry at that loc', () => {
    const tracerWithRenderedFile = mockTracer as { renderedFile?: string | null; makeSourceKey?: unknown };
    tracerWithRenderedFile.renderedFile = 'src/components/Hero.tsx';
    tracerWithRenderedFile.makeSourceKey = (s: { fileName: string; line: number; column: number }) =>
      `${s.fileName}:${s.line}:${s.column}`;
    mockBuildSourceKeyIndex.mockReturnValueOnce(
      new Map([
        ['src/App.tsx:7:6', { nodeRef: 'src/App.tsx:2', source: { fileName: 'src/App.tsx', line: 7, column: 6 } }],
      ]),
    );
    try {
      const result = resolveUuidToNodeRef('uuid-button-1', mockEngine as never);
      expect(result).toBe('src/App.tsx:2');
    } finally {
      tracerWithRenderedFile.renderedFile = null;
      delete tracerWithRenderedFile.makeSourceKey;
    }
  });

  it('should return original id when UUID not found in AST', () => {
    const result = resolveUuidToNodeRef('nonexistent-uuid', mockEngine as never);
    expect(result).toBe('nonexistent-uuid');
  });

  it('should return original id when no matching source in tracer', () => {
    mockBuildSourceKeyIndex.mockReturnValueOnce(new Map());

    const result = resolveUuidToNodeRef('uuid-div-1', mockEngine as never);
    expect(result).toBe('uuid-div-1');
  });
});

// --------------------------------------------------------------------------
// getElementLocByUuid
// --------------------------------------------------------------------------

describe('getElementLocByUuid', () => {
  it('should return start and end source location for a known UUID', () => {
    const result = getElementLocByUuid('uuid-button-1', mockEngine as never);
    expect(result).toEqual({ line: 7, column: 6, endLine: 7, endColumn: 30 });
  });

  it('should return null for an unknown UUID', () => {
    const result = getElementLocByUuid('nonexistent-uuid', mockEngine as never);
    expect(result).toBeNull();
  });

  it('should return null when the node has no loc', () => {
    const noLocEngine = {
      getRoot: () => ({
        metadata: { sampleStructure: [{ id: 'uuid-no-loc', type: 'div' }] as ASTNode[] },
        children: [],
      }),
      getInstance: () => null,
    };
    const result = getElementLocByUuid('uuid-no-loc', noLocEngine as never);
    expect(result).toBeNull();
  });
});

// --------------------------------------------------------------------------
// resolveIdsToUuids
// --------------------------------------------------------------------------

describe('resolveIdsToUuids', () => {
  it('should return empty array for empty input', () => {
    const result = resolveIdsToUuids([], mockEngine as never);
    expect(result).toEqual([]);
  });

  it('should map multiple nodeRefs to UUIDs', () => {
    mockGetSourceByNodeRef.mockReturnValueOnce({ fileName: 'src/App.tsx', line: 5, column: 4 });
    mockGetSourceByNodeRef.mockReturnValueOnce({ fileName: 'src/App.tsx', line: 6, column: 6 });

    const result = resolveIdsToUuids(['src/App.tsx:0', 'src/App.tsx:1'], mockEngine as never);
    expect(result).toEqual(['uuid-div-1', 'uuid-span-1']);
  });

  it('should pass through UUIDs that are not nodeRefs', () => {
    mockGetSourceByNodeRef.mockReturnValueOnce(null);

    const result = resolveIdsToUuids(['uuid-div-1'], mockEngine as never);
    expect(result).toEqual(['uuid-div-1']);
  });
});
