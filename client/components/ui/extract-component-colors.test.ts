import { describe, expect, test } from 'bun:test';
import type { ASTNode } from '@/lib/canvas-engine/types/ast';
import { extractComponentColors } from './extract-component-colors';

const makeNode = (id: string, props?: Record<string, unknown>, children?: ASTNode[]): ASTNode => ({
  id,
  type: 'div',
  props,
  children,
});

describe('extractComponentColors', () => {
  test('extracts backgroundColor from props.className (Tailwind)', () => {
    const ast: ASTNode[] = [makeNode('1', { className: 'bg-blue-500 text-white p-4' })];
    const result = extractComponentColors(ast, 'tailwind');
    expect(result.some((c) => c.value === 'blue-500')).toBe(true);
    expect(result.some((c) => c.value === 'white')).toBe(true);
  });

  test('deduplicates same color, counts occurrences, collects nodeIds', () => {
    const ast: ASTNode[] = [
      makeNode('1', { className: 'bg-blue-500' }),
      makeNode('2', { className: 'bg-blue-500 text-blue-500' }),
    ];
    const result = extractComponentColors(ast, 'tailwind');
    const blue500 = result.find((c) => c.value === 'blue-500');
    expect(blue500?.count).toBe(3);
    expect(blue500?.nodeIds).toEqual(['1', '2']);
  });

  test('sorts tokens first, then hex by count', () => {
    const ast: ASTNode[] = [makeNode('1', { className: 'bg-[#ff0000]' }), makeNode('2', { className: 'bg-blue-500' })];
    const result = extractComponentColors(ast, 'tailwind');
    expect(result[0].isToken).toBe(true);
  });

  test('deduplicates token and hex with same resolved color', () => {
    const ast: ASTNode[] = [makeNode('1', { className: 'bg-blue-500' }), makeNode('2', { className: 'bg-[#3b82f6]' })];
    const result = extractComponentColors(ast, 'tailwind');
    const blues = result.filter((c) => c.hex === '#3b82f6');
    expect(blues).toHaveLength(1);
    expect(blues[0].isToken).toBe(true);
  });

  test('returns empty for nodes without color props', () => {
    const ast: ASTNode[] = [makeNode('1', { className: 'p-4 flex' })];
    const result = extractComponentColors(ast, 'tailwind');
    expect(result).toHaveLength(0);
  });

  test('traverses children recursively', () => {
    const ast: ASTNode[] = [
      makeNode('1', { className: 'bg-red-500' }, [
        makeNode('2', { className: 'text-green-500' }, [makeNode('3', { className: 'border-blue-500' })]),
      ]),
    ];
    const result = extractComponentColors(ast, 'tailwind');
    expect(result).toHaveLength(3);
  });

  test('extracts inline style colors', () => {
    const ast: ASTNode[] = [makeNode('1', { style: { backgroundColor: '#ff0000', color: '#00ff00' } })];
    const result = extractComponentColors(ast, 'tailwind');
    expect(result.some((c) => c.hex === '#ff0000')).toBe(true);
    expect(result.some((c) => c.hex === '#00ff00')).toBe(true);
  });

  test('stores nodeId, nodeIds, and line from AST node', () => {
    const ast: ASTNode[] = [
      {
        id: 'node-42',
        type: 'div',
        props: { className: 'bg-blue-500' },
        loc: { start: { line: 10, column: 4 }, end: { line: 10, column: 30 } },
      },
    ];
    const result = extractComponentColors(ast, 'tailwind');
    expect(result[0].nodeId).toBe('node-42');
    expect(result[0].nodeIds).toEqual(['node-42']);
    expect(result[0].line).toBe(10);
  });

  test('inline style ignores non-hex values', () => {
    const ast: ASTNode[] = [makeNode('1', { style: { backgroundColor: 'red', color: 'var(--foo)' } })];
    const result = extractComponentColors(ast, 'tailwind');
    expect(result).toHaveLength(0);
  });
});
