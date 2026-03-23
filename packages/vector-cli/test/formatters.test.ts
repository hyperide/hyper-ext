import { describe, expect, it } from 'bun:test';
import { createContext } from '../src/context';
import { formatEdgesTable, formatNodesTable } from '../src/formatters/table';
import { formatDAGTree } from '../src/formatters/tree';
import { runInSandbox } from '../src/sandbox';

describe('table formatter', () => {
  it('should format nodes as table', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50).fill("#ff0000")');
    const table = formatNodesTable(ctx);
    expect(table).toContain('rectangle');
    expect(table).toContain('fill');
    expect(table).toContain('ID');
    expect(table).toContain('Type');
  });

  it('should format edges', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50).fill("#ff0000")');
    const table = formatEdgesTable(ctx);
    expect(table).toContain('→');
    expect(table).toContain('path');
  });

  it('should handle empty graph', () => {
    const ctx = createContext();
    expect(formatNodesTable(ctx)).toContain('empty');
    expect(formatEdgesTable(ctx)).toContain('no edges');
  });

  it('should show muted nodes', () => {
    const ctx = createContext();
    runInSandbox(
      ctx,
      `
      const r = rect(100, 50);
      mute(r);
    `,
    );
    const table = formatNodesTable(ctx);
    expect(table).toContain('✗');
  });

  it('should align columns correctly', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50)');
    const table = formatNodesTable(ctx);
    const lines = table.split('\n');
    // Header, separator, and at least one data row
    expect(lines.length).toBeGreaterThanOrEqual(3);
    // Separator line should contain box-drawing chars
    expect(lines[1]).toContain('─');
  });
});

describe('tree formatter', () => {
  it('should format DAG as tree', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50).fill("#ff0000").stroke("#000", 2)');
    const tree = formatDAGTree(ctx);
    expect(tree).toContain('rectangle');
    expect(tree).toContain('fill');
    expect(tree).toContain('stroke');
    expect(tree).toContain('→');
  });

  it('should show param summaries', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50)');
    const tree = formatDAGTree(ctx);
    expect(tree).toContain('100×50');
  });

  it('should handle empty graph', () => {
    const ctx = createContext();
    expect(formatDAGTree(ctx)).toContain('empty');
  });

  it('should handle branching DAG', () => {
    const ctx = createContext();
    runInSandbox(
      ctx,
      `
      const r = rect(100, 100);
      const c = circle(50);
      union(r, c).fill("#f00");
    `,
    );
    const tree = formatDAGTree(ctx);
    expect(tree).toContain('rectangle');
    expect(tree).toContain('ellipse');
  });

  it('should show ellipse param summary', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'circle(30)');
    const tree = formatDAGTree(ctx);
    expect(tree).toContain('rx=30');
  });

  it('should mark muted nodes', () => {
    const ctx = createContext();
    runInSandbox(
      ctx,
      `
      const r = rect(50, 50);
      mute(r);
    `,
    );
    const tree = formatDAGTree(ctx);
    expect(tree).toContain('[muted]');
  });
});
