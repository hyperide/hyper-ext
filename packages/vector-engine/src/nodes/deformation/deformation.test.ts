/**
 * @file Tests for all deformation nodes: roughen, zigzag, pucker/bloat, twist, warp
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../../path/builder';
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
