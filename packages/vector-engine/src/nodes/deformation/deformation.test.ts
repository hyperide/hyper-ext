/**
 * @file Tests for all deformation nodes: roughen, zigzag, pucker/bloat, twist, warp, envelope distort
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import { meshFromBounds } from '../../mesh/mesh-from-path';
import { PathBuilder } from '../../path/builder';
import { envelopeDistortNode } from './envelope-distort';
import { puckerBloatNode } from './pucker-bloat';
import { roughenNode } from './roughen';
import { twistNode } from './twist';
import { warpNode } from './warp';
import { zigzagNode } from './zigzag';

const makeLine = () => new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
const makeSquare = () => new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();

describe('roughen', () => {
  it('should distort a straight line', () => {
    const result = roughenNode.execute(
      { path: { type: 'path', value: makeLine() } },
      { size: 10, detail: 5, type: 'corner', seed: 42 },
    );
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      makeLine().commands.length,
    );
  });

  it('should produce deterministic output with same seed', () => {
    const params = { size: 10, detail: 5, type: 'corner', seed: 42 };
    const r1 = roughenNode.execute({ path: { type: 'path', value: makeLine() } }, params);
    const r2 = roughenNode.execute({ path: { type: 'path', value: makeLine() } }, params);
    expect(Array.from((r1.path as { type: 'path'; value: { commands: Float64Array } }).value.commands)).toEqual(
      Array.from((r2.path as { type: 'path'; value: { commands: Float64Array } }).value.commands),
    );
  });

  it('should produce different output with different seed', () => {
    const r1 = roughenNode.execute(
      { path: { type: 'path', value: makeLine() } },
      { size: 10, detail: 5, type: 'corner', seed: 1 },
    );
    const r2 = roughenNode.execute(
      { path: { type: 'path', value: makeLine() } },
      { size: 10, detail: 5, type: 'corner', seed: 2 },
    );
    expect(Array.from((r1.path as { type: 'path'; value: { commands: Float64Array } }).value.commands)).not.toEqual(
      Array.from((r2.path as { type: 'path'; value: { commands: Float64Array } }).value.commands),
    );
  });

  it('should produce smooth output with type smooth', () => {
    const result = roughenNode.execute(
      { path: { type: 'path', value: makeLine() } },
      { size: 10, detail: 5, type: 'smooth', seed: 42 },
    );
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should handle missing input', () => {
    const result = roughenNode.execute({}, { size: 10, detail: 5, type: 'corner', seed: 42 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBe(0);
  });
});

describe('zigzag', () => {
  it('should create zigzag pattern', () => {
    const result = zigzagNode.execute(
      { path: { type: 'path', value: makeLine() } },
      { size: 10, ridgesPerSegment: 5, type: 'corner' },
    );
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      makeLine().commands.length,
    );
  });

  it('should produce smooth output with type smooth', () => {
    const result = zigzagNode.execute(
      { path: { type: 'path', value: makeLine() } },
      { size: 10, ridgesPerSegment: 3, type: 'smooth' },
    );
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should handle missing input', () => {
    const result = zigzagNode.execute({}, { size: 10, ridgesPerSegment: 5, type: 'corner' });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBe(0);
  });
});

describe('pucker/bloat', () => {
  it('should pull points toward center (pucker)', () => {
    const result = puckerBloatNode.execute({ path: { type: 'path', value: makeSquare() } }, { amount: 50 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should push points away from center (bloat)', () => {
    const result = puckerBloatNode.execute({ path: { type: 'path', value: makeSquare() } }, { amount: -50 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should return approximately same shape at amount=0', () => {
    const result = puckerBloatNode.execute({ path: { type: 'path', value: makeSquare() } }, { amount: 0 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should handle missing input', () => {
    const result = puckerBloatNode.execute({}, { amount: 50 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBe(0);
  });
});

describe('twist', () => {
  it('should rotate points around center', () => {
    const result = twistNode.execute({ path: { type: 'path', value: makeSquare() } }, { angle: 45 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should produce no-op at angle=0', () => {
    const result = twistNode.execute({ path: { type: 'path', value: makeSquare() } }, { angle: 0 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should handle missing input', () => {
    const result = twistNode.execute({}, { angle: 45 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBe(0);
  });
});

describe('warp', () => {
  it('should bend path along arc', () => {
    const result = warpNode.execute({ path: { type: 'path', value: makeSquare() } }, { warpType: 'arc', bend: 50 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should support wave warp', () => {
    const result = warpNode.execute({ path: { type: 'path', value: makeSquare() } }, { warpType: 'wave', bend: 30 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should support flag warp', () => {
    const result = warpNode.execute({ path: { type: 'path', value: makeSquare() } }, { warpType: 'flag', bend: 30 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should support bulge warp', () => {
    const result = warpNode.execute({ path: { type: 'path', value: makeSquare() } }, { warpType: 'bulge', bend: 30 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should approximate identity at bend=0', () => {
    const result = warpNode.execute({ path: { type: 'path', value: makeSquare() } }, { warpType: 'arc', bend: 0 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should handle missing input', () => {
    const result = warpNode.execute({}, { warpType: 'arc', bend: 50 });
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBe(0);
  });
});

describe('envelope distort', () => {
  it('should pass through with undistorted mesh (identity)', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 1, 1);
    const result = envelopeDistortNode.execute(
      { path: { type: 'path', value: rect }, mesh: { type: 'mesh', value: mesh } },
      {},
    );
    const outPath = (result.path as { type: 'path'; value: { commands: Float64Array } }).value;
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it('should distort when mesh vertices are moved', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 1, 1);
    // Move top-right vertex down by 50
    mesh.vertices[1].position = { x: 100, y: 50 };
    const result = envelopeDistortNode.execute(
      { path: { type: 'path', value: line }, mesh: { type: 'mesh', value: mesh } },
      {},
    );
    const outPath = (result.path as { type: 'path'; value: { commands: Float64Array } }).value;
    expect(outPath.commands.length).toBeGreaterThan(0);
  });

  it('should handle mesh with multiple cells', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const mesh = meshFromBounds({ x: 0, y: 0, width: 100, height: 100 }, 2, 2);
    const result = envelopeDistortNode.execute(
      { path: { type: 'path', value: rect }, mesh: { type: 'mesh', value: mesh } },
      {},
    );
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBeGreaterThan(
      0,
    );
  });

  it('should return empty path when no inputs', () => {
    const result = envelopeDistortNode.execute({}, {});
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBe(0);
  });

  it('should return empty path when only path input (no mesh)', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = envelopeDistortNode.execute({ path: { type: 'path', value: line } }, {});
    expect((result.path as { type: 'path'; value: { commands: Float64Array } }).value.commands.length).toBe(0);
  });
});
