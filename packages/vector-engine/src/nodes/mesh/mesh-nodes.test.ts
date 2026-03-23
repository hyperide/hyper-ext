import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../../path/builder';
import type { MeshValue, NodeValue } from '../../types';
import { gradientMeshNode } from './gradient-mesh';
import { meshFromPathNode } from './mesh-from-path-node';

type MeshNodeValue = NodeValue & { type: 'mesh'; value: MeshValue };

function asMesh(val: NodeValue | NodeValue[]): MeshValue {
  return (val as MeshNodeValue).value;
}

describe('gradientMeshNode', () => {
  it('should have correct definition', () => {
    expect(gradientMeshNode.type).toBe('gradientMesh');
    expect(gradientMeshNode.category).toBe('generator');
    expect(gradientMeshNode.outputs[0].type).toBe('mesh');
  });

  it('should create mesh with given dimensions', () => {
    const result = gradientMeshNode.execute(
      {},
      { rows: 2, cols: 3, width: 100, height: 100, x: 0, y: 0, color: '#ffffff' },
    );
    const meshVal = result.mesh as NodeValue;
    expect(meshVal.type).toBe('mesh');
    const mesh = asMesh(meshVal);
    expect(mesh.rows).toBe(2);
    expect(mesh.cols).toBe(3);
    expect(mesh.vertices.length).toBe(12);
  });

  it('should place vertices at correct positions', () => {
    const result = gradientMeshNode.execute(
      {},
      { rows: 1, cols: 1, width: 100, height: 50, x: 10, y: 20, color: '#ffffff' },
    );
    const mesh = asMesh(result.mesh as NodeValue);
    expect(mesh.vertices[0].position).toEqual({ x: 10, y: 20 });
    expect(mesh.vertices[1].position).toEqual({ x: 110, y: 20 });
  });

  it('should apply initial color', () => {
    const result = gradientMeshNode.execute(
      {},
      { rows: 1, cols: 1, width: 100, height: 100, x: 0, y: 0, color: '#ff0000' },
    );
    const mesh = asMesh(result.mesh as NodeValue);
    expect(mesh.vertices[0].color).toBe('#ff0000');
  });
});

describe('meshFromPathNode', () => {
  it('should create mesh fitted to path bounds', () => {
    const rect = new PathBuilder().moveTo(10, 20).lineTo(110, 20).lineTo(110, 120).lineTo(10, 120).close().build();
    const result = meshFromPathNode.execute({ path: { type: 'path', value: rect } as NodeValue }, { rows: 2, cols: 2 });
    const mesh = asMesh(result.mesh as NodeValue);
    expect(mesh.rows).toBe(2);
    expect(mesh.cols).toBe(2);
    expect(mesh.vertices[0].position.x).toBeCloseTo(10, 0);
    expect(mesh.vertices[0].position.y).toBeCloseTo(20, 0);
  });

  it('should handle empty path', () => {
    const empty = new PathBuilder().build();
    const result = meshFromPathNode.execute(
      { path: { type: 'path', value: empty } as NodeValue },
      { rows: 1, cols: 1 },
    );
    const mesh = asMesh(result.mesh as NodeValue);
    expect(mesh.vertices.length).toBe(4);
  });

  it('should handle no path input', () => {
    const result = meshFromPathNode.execute({}, { rows: 1, cols: 1 });
    const mesh = asMesh(result.mesh as NodeValue);
    expect(mesh.vertices.length).toBe(4);
  });
});
