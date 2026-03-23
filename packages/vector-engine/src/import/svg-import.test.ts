import { describe, expect, it } from 'bun:test';
import { svgToGraph } from './svg-import';

describe('SVG import', () => {
  it('should import a simple rectangle', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80"/></svg>';
    const result = svgToGraph(svg);
    const rectNode = result.nodes.find((n) => n.type === 'rectangle');
    expect(rectNode).toBeDefined();
    expect(rectNode?.params.width).toBe(80);
    expect(rectNode?.params.height).toBe(80);
  });

  it('should import path element as svgPath', () => {
    const svg = '<svg viewBox="0 0 100 100"><path d="M 0 0 L 100 0 L 100 100 Z"/></svg>';
    const result = svgToGraph(svg);
    const pathNode = result.nodes.find((n) => n.type === 'svgPath');
    expect(pathNode).toBeDefined();
    expect(pathNode?.params.d).toBe('M 0 0 L 100 0 L 100 100 Z');
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
    expect(pathNode?.params.d as string).toContain('M');
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

  it('should import ellipse element with rx/ry', () => {
    const svg = '<svg viewBox="0 0 200 200"><ellipse cx="100" cy="100" rx="80" ry="40"/></svg>';
    const result = svgToGraph(svg);
    const ellipse = result.nodes.find((n) => n.type === 'ellipse');
    expect(ellipse).toBeDefined();
    expect(ellipse?.params.rx).toBe(80);
    expect(ellipse?.params.ry).toBe(40);
    expect(ellipse?.params.cx).toBe(100);
    expect(ellipse?.params.cy).toBe(100);
  });

  it('should import line element', () => {
    const svg = '<svg viewBox="0 0 100 100"><line x1="10" y1="20" x2="90" y2="80"/></svg>';
    const result = svgToGraph(svg);
    const lineNode = result.nodes.find((n) => n.type === 'line');
    expect(lineNode).toBeDefined();
    expect(lineNode?.params.x1).toBe(10);
    expect(lineNode?.params.y1).toBe(20);
    expect(lineNode?.params.x2).toBe(90);
    expect(lineNode?.params.y2).toBe(80);
  });

  it('should import polyline element as svgPath without close', () => {
    const svg = '<svg viewBox="0 0 100 100"><polyline points="0,0 50,100 100,0"/></svg>';
    const result = svgToGraph(svg);
    const pathNode = result.nodes.find((n) => n.type === 'svgPath');
    expect(pathNode).toBeDefined();
    const d = pathNode?.params.d as string;
    expect(d).toContain('M');
    expect(d).toContain('L');
    // polyline must NOT be closed
    expect(d).not.toContain('Z');
  });

  it('should parse rotate transform', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect width="50" height="50" transform="rotate(45)"/></svg>';
    const result = svgToGraph(svg);
    const rotateNode = result.nodes.find((n) => n.type === 'rotate');
    expect(rotateNode).toBeDefined();
    expect(rotateNode?.params.angle).toBe(45);
  });

  it('should parse rotate transform with origin', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect width="50" height="50" transform="rotate(90,50,50)"/></svg>';
    const result = svgToGraph(svg);
    const rotateNode = result.nodes.find((n) => n.type === 'rotate');
    expect(rotateNode).toBeDefined();
    expect(rotateNode?.params.angle).toBe(90);
    expect(rotateNode?.params.originX).toBe(50);
    expect(rotateNode?.params.originY).toBe(50);
  });

  it('should parse scale transform', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect width="50" height="50" transform="scale(2,3)"/></svg>';
    const result = svgToGraph(svg);
    const scaleNode = result.nodes.find((n) => n.type === 'scale');
    expect(scaleNode).toBeDefined();
    expect(scaleNode?.params.sx).toBe(2);
    expect(scaleNode?.params.sy).toBe(3);
  });

  it('should parse uniform scale transform with single value', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect width="50" height="50" transform="scale(2)"/></svg>';
    const result = svgToGraph(svg);
    const scaleNode = result.nodes.find((n) => n.type === 'scale');
    expect(scaleNode).toBeDefined();
    expect(scaleNode?.params.sx).toBe(2);
    expect(scaleNode?.params.sy).toBe(2);
  });

  it('should parse matrix transform', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect width="50" height="50" transform="matrix(1,0,0,1,10,20)"/></svg>';
    const result = svgToGraph(svg);
    const matrixNode = result.nodes.find((n) => n.type === 'matrix');
    expect(matrixNode).toBeDefined();
    expect(matrixNode?.params.a).toBe(1);
    expect(matrixNode?.params.e).toBe(10);
    expect(matrixNode?.params.f).toBe(20);
  });

  it('should ignore unrecognised transform function', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect width="50" height="50" transform="skewX(30)"/></svg>';
    const result = svgToGraph(svg);
    // skewX is not handled — no transform node should be added
    const transformNode = result.nodes.find(
      (n) => n.type === 'translate' || n.type === 'rotate' || n.type === 'scale' || n.type === 'matrix',
    );
    expect(transformNode).toBeUndefined();
  });

  it('should handle invalid SVG string gracefully', () => {
    const result = svgToGraph('not an svg');
    expect(result.nodes.length).toBe(0);
    expect(result.canvas).toEqual({ width: 0, height: 0 });
  });
});
