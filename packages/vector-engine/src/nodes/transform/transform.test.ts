import { describe, expect, it } from 'bun:test';
import type { NodeValue, TransformMatrix } from '../../types';
import { composeTransforms } from './compose';
import { rotateNode } from './rotate';
import { scaleNode } from './scale';
import { skewNode } from './skew';
import { translateNode } from './translate';

describe('Translate node', () => {
  it('should output a translation matrix', () => {
    const result = translateNode.execute({}, { dx: 10, dy: 20 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m).toEqual([1, 0, 0, 1, 10, 20]);
  });
});

describe('Rotate node', () => {
  it('should output a rotation matrix (90 degrees)', () => {
    const result = rotateNode.execute({}, { angle: 90, originX: 0, originY: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m[0]).toBeCloseTo(0, 5);
    expect(m[1]).toBeCloseTo(1, 5);
    expect(m[2]).toBeCloseTo(-1, 5);
    expect(m[3]).toBeCloseTo(0, 5);
  });

  it('should handle rotation with origin', () => {
    const result = rotateNode.execute({}, { angle: 180, originX: 50, originY: 50 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    // After 180° around (50,50): translation components should be ≈ (100, 100)
    expect(m[4]).toBeCloseTo(100, 5);
    expect(m[5]).toBeCloseTo(100, 5);
  });
});

describe('Scale node', () => {
  it('should output a scale matrix', () => {
    const result = scaleNode.execute({}, { sx: 2, sy: 3, originX: 0, originY: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m).toEqual([2, 0, 0, 3, 0, 0]);
  });

  it('should handle scale with origin', () => {
    const result = scaleNode.execute({}, { sx: 2, sy: 2, originX: 50, originY: 50 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    // T(50,50) × S(2,2) × T(-50,-50): e = 50 - 50*2 = -50, f = 50 - 50*2 = -50
    expect(m[4]).toBeCloseTo(-50);
    expect(m[5]).toBeCloseTo(-50);
  });
});

describe('Skew node', () => {
  it('should output a skew matrix', () => {
    const result = skewNode.execute({}, { ax: 45, ay: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m[0]).toBeCloseTo(1);
    expect(m[2]).toBeCloseTo(1); // tan(45°) = 1
    expect(m[3]).toBeCloseTo(1);
  });

  it('should handle skewY', () => {
    const result = skewNode.execute({}, { ax: 0, ay: 45 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m[1]).toBeCloseTo(1); // tan(45°) = 1
    expect(m[2]).toBeCloseTo(0);
  });
});

describe('Translate node — edge cases', () => {
  it('translate(0, 0) should produce identity matrix', () => {
    const result = translateNode.execute({}, { dx: 0, dy: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('Scale node — edge cases', () => {
  it('scale(0, 0) should produce zero scale matrix without crashing', () => {
    const result = scaleNode.execute({}, { sx: 0, sy: 0, originX: 0, originY: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    // [sx, 0, 0, sy, ox - ox*sx, oy - oy*sy] = [0, 0, 0, 0, 0, 0]
    expect(m[0]).toBe(0);
    expect(m[3]).toBe(0);
    expect(m[4]).toBe(0);
    expect(m[5]).toBe(0);
  });

  it('scale(-1, 1) should produce a horizontal flip matrix', () => {
    const result = scaleNode.execute({}, { sx: -1, sy: 1, originX: 0, originY: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m[0]).toBe(-1);
    expect(m[3]).toBe(1);
    expect(m[4]).toBe(0);
    expect(m[5]).toBe(0);
  });
});

describe('Rotate node — edge cases', () => {
  it('rotate 360° should approximate identity matrix', () => {
    const result = rotateNode.execute({}, { angle: 360, originX: 0, originY: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m[0]).toBeCloseTo(1, 10); // cos(360°)
    expect(m[1]).toBeCloseTo(0, 10); // sin(360°)
    expect(m[2]).toBeCloseTo(0, 10); // -sin(360°)
    expect(m[3]).toBeCloseTo(1, 10); // cos(360°)
    expect(m[4]).toBeCloseTo(0, 10);
    expect(m[5]).toBeCloseTo(0, 10);
  });

  it('rotate 180° should flip both axes', () => {
    const result = rotateNode.execute({}, { angle: 180, originX: 0, originY: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m[0]).toBeCloseTo(-1, 5); // cos(180°)
    expect(m[1]).toBeCloseTo(0, 5); // sin(180°)
    expect(m[2]).toBeCloseTo(0, 5); // -sin(180°)
    expect(m[3]).toBeCloseTo(-1, 5); // cos(180°)
    expect(m[4]).toBeCloseTo(0, 5);
    expect(m[5]).toBeCloseTo(0, 5);
  });
});

describe('Skew node — edge cases', () => {
  it('skew(89°) should produce large but finite values', () => {
    const result = skewNode.execute({}, { ax: 89, ay: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    // tan(89°) ≈ 57.29 — large but not Infinity
    expect(Number.isFinite(m[2])).toBe(true);
    expect(m[2]).toBeGreaterThan(50);
  });
});

describe('composeTransforms', () => {
  const identity: TransformMatrix = [1, 0, 0, 1, 0, 0];

  it('should return local when no incoming transform', () => {
    const local: TransformMatrix = [1, 0, 0, 1, 10, 20];
    const result = composeTransforms(undefined, local);
    expect(result).toEqual(local);
  });

  it('should return local when incoming has wrong type', () => {
    const local: TransformMatrix = [1, 0, 0, 1, 10, 20];
    const result = composeTransforms({ type: 'number', value: 42 }, local);
    expect(result).toEqual(local);
  });

  it('should compose identity with translation — result equals translation', () => {
    const translate: TransformMatrix = [1, 0, 0, 1, 30, 40];
    // local * identity = local
    const result = composeTransforms({ type: 'transform', value: identity }, translate);
    expect(result[4]).toBeCloseTo(30, 10);
    expect(result[5]).toBeCloseTo(40, 10);
  });

  it('should compose two translations — result is sum of translations', () => {
    // local = translate(10, 20), incoming = translate(5, 7)
    // result = local * incoming → tx = 10*1 + 0*7 + 10 = 15 ... wait use matrix math
    // result[4] = local[0]*incoming[4] + local[2]*incoming[5] + local[4]
    //           = 1*5 + 0*7 + 10 = 15
    // result[5] = local[1]*incoming[4] + local[3]*incoming[5] + local[5]
    //           = 0*5 + 1*7 + 20 = 27
    const local: TransformMatrix = [1, 0, 0, 1, 10, 20];
    const incoming: TransformMatrix = [1, 0, 0, 1, 5, 7];
    const result = composeTransforms({ type: 'transform', value: incoming }, local);
    expect(result[4]).toBeCloseTo(15, 10);
    expect(result[5]).toBeCloseTo(27, 10);
    // Linear components unchanged
    expect(result[0]).toBeCloseTo(1, 10);
    expect(result[3]).toBeCloseTo(1, 10);
  });

  it('should compose rotation with scale', () => {
    // local = scale(2, 2), incoming = rotate(90°)
    // rotate(90°): [cos90, sin90, -sin90, cos90, 0, 0] = [0, 1, -1, 0, 0, 0]
    const scale2: TransformMatrix = [2, 0, 0, 2, 0, 0];
    const rot90: TransformMatrix = [0, 1, -1, 0, 0, 0];
    const result = composeTransforms({ type: 'transform', value: rot90 }, scale2);
    // result = scale2 * rot90
    // [a,b,c,d,e,f] where a = scale2[0]*rot90[0] + scale2[2]*rot90[1] = 2*0 + 0*1 = 0
    // b = scale2[1]*rot90[0] + scale2[3]*rot90[1] = 0*0 + 2*1 = 2
    // c = scale2[0]*rot90[2] + scale2[2]*rot90[3] = 2*-1 + 0*0 = -2
    // d = scale2[1]*rot90[2] + scale2[3]*rot90[3] = 0*-1 + 2*0 = 0
    expect(result[0]).toBeCloseTo(0, 10);
    expect(result[1]).toBeCloseTo(2, 10);
    expect(result[2]).toBeCloseTo(-2, 10);
    expect(result[3]).toBeCloseTo(0, 10);
  });

  it('should compose identity with itself — result is identity', () => {
    const result = composeTransforms({ type: 'transform', value: identity }, identity);
    expect(result).toEqual(identity);
  });
});

describe('Transform matrix — composition verification', () => {
  it('translate(30, 40) should produce exact known matrix values', () => {
    const result = translateNode.execute({}, { dx: 30, dy: 40 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m).toEqual([1, 0, 0, 1, 30, 40]);
  });

  it('scale(3, 4) at origin should produce exact known matrix values', () => {
    const result = scaleNode.execute({}, { sx: 3, sy: 4, originX: 0, originY: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m).toEqual([3, 0, 0, 4, 0, 0]);
  });

  it('rotate(90°) at origin should produce cos=0, sin=1, tx=0, ty=0', () => {
    const result = rotateNode.execute({}, { angle: 90, originX: 0, originY: 0 });
    const m = (result.transform as NodeValue).value as TransformMatrix;
    expect(m[0]).toBeCloseTo(0, 5); // cos(90°)
    expect(m[1]).toBeCloseTo(1, 5); // sin(90°)
    expect(m[2]).toBeCloseTo(-1, 5); // -sin(90°)
    expect(m[3]).toBeCloseTo(0, 5); // cos(90°)
    expect(m[4]).toBeCloseTo(0, 5);
    expect(m[5]).toBeCloseTo(0, 5);
  });
});
