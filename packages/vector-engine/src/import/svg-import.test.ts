import { describe, expect, it } from 'bun:test';
import { svgToGraph } from './svg-import';

describe('SVG import', () => {
  it('should import a simple rectangle', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80"/></svg>';
    const result = svgToGraph(svg);
    const rectNode = result.nodes.find((n) => n.type === 'rectangle');
    expect(rectNode).toBeDefined();
    expect(rectNode!.params.width).toBe(80);
    expect(rectNode!.params.height).toBe(80);
  });

  it('should import path element as svgPath', () => {
    const svg = '<svg viewBox="0 0 100 100"><path d="M 0 0 L 100 0 L 100 100 Z"/></svg>';
    const result = svgToGraph(svg);
    const pathNode = result.nodes.find((n) => n.type === 'svgPath');
    expect(pathNode).toBeDefined();
    expect(pathNode!.params.d).toBe('M 0 0 L 100 0 L 100 100 Z');
  });

  it('should import fill and stroke', () => {
    const svg =
      '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#ff0000" stroke="#000" stroke-width="2"/></svg>';
    const result = svgToGraph(svg);
    const fillNode = result.nodes.find((n) => n.type === 'fill');
    expect(fillNode).toBeDefined();
  });

  it('should import circle as ellipse', () => {
    const svg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';
    const result = svgToGraph(svg);
    const ellipse = result.nodes.find((n) => n.type === 'ellipse');
    expect(ellipse).toBeDefined();
  });

  it('should import polygon as svgPath', () => {
    const svg = '<svg viewBox="0 0 100 100"><polygon points="50,0 100,100 0,100"/></svg>';
    const result = svgToGraph(svg);
    const pathNode = result.nodes.find((n) => n.type === 'svgPath');
    expect(pathNode).toBeDefined();
    expect(pathNode!.params.d as string).toContain('M');
  });

  it('should extract viewBox canvas dimensions', () => {
    const svg = '<svg viewBox="0 0 400 300"><rect width="100" height="100"/></svg>';
    const result = svgToGraph(svg);
    expect(result.canvas).toEqual({ width: 400, height: 300 });
  });

  it('should create edges connecting nodes', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect fill="#f00" width="100" height="100"/></svg>';
    const result = svgToGraph(svg);
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle groups with transform', () => {
    const svg = '<svg viewBox="0 0 200 200"><g transform="translate(50,50)"><rect width="100" height="100"/></g></svg>';
    const result = svgToGraph(svg);
    const translateNode = result.nodes.find((n) => n.type === 'translate');
    expect(translateNode).toBeDefined();
  });

  it('should handle SVG without viewBox', () => {
    const svg = '<svg width="200" height="100"><rect width="100" height="50"/></svg>';
    const result = svgToGraph(svg);
    expect(result.canvas.width).toBe(200);
    expect(result.canvas.height).toBe(100);
  });

  it('should handle empty SVG', () => {
    const svg = '<svg viewBox="0 0 100 100"></svg>';
    const result = svgToGraph(svg);
    expect(result.nodes.length).toBe(0);
    expect(result.edges.length).toBe(0);
  });
});
