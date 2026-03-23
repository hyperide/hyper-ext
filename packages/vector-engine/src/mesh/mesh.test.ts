import { describe, expect, it } from 'bun:test';
import { meshFromBounds } from './mesh-from-path';
import { tessellateMesh } from './tessellate';

describe('gradient mesh', () => {
  it('should create a 2x2 mesh from bounds', () => {
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 2, 2);
    expect(mesh.rows).toBe(2);
    expect(mesh.cols).toBe(2);
    expect(mesh.vertices.length).toBe(9); // (2+1) × (2+1)
  });

  it('should create a 1x1 mesh with 4 vertices', () => {
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 1, 1);
    expect(mesh.rows).toBe(1);
    expect(mesh.cols).toBe(1);
    expect(mesh.vertices.length).toBe(4); // (1+1) × (1+1)
  });

  it('should place vertices at correct positions', () => {
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 1, 1);
    expect(mesh.vertices[0].position).toEqual({ x: 0, y: 0 });
    expect(mesh.vertices[1].position).toEqual({ x: 100, y: 0 });
    expect(mesh.vertices[2].position).toEqual({ x: 0, y: 100 });
    expect(mesh.vertices[3].position).toEqual({ x: 100, y: 100 });
  });

  it('should tessellate mesh into triangles', () => {
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 1, 1);
    const result = tessellateMesh(mesh, 4);
    expect(result.positions.length).toBeGreaterThan(0);
    expect(result.positions.length % 2).toBe(0); // x,y pairs
    expect(result.colors.length).toBe(result.positions.length / 2);
    expect(result.indices.length).toBeGreaterThan(0);
    expect(result.indices.length % 3).toBe(0); // triangles
  });

  it('should clamp zero rows/cols to 1 to avoid NaN positions', () => {
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 0, 0);
    expect(mesh.rows).toBe(1);
    expect(mesh.cols).toBe(1);
    expect(mesh.vertices.length).toBe(4);
    for (const v of mesh.vertices) {
      expect(Number.isNaN(v.position.x)).toBe(false);
      expect(Number.isNaN(v.position.y)).toBe(false);
    }
  });

  it('should handle higher subdivision', () => {
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 1, 1);
    const low = tessellateMesh(mesh, 2);
    const high = tessellateMesh(mesh, 8);
    expect(high.positions.length).toBeGreaterThan(low.positions.length);
  });
});
