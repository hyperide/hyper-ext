/**
 * @file Tests for WASM-backed path op nodes — offset, stroke-to-path, dash
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import { MockPathOps } from 'vector-wasm';
import { PathBuilder } from '../../path/builder';
import type { NodeValue } from '../../types';
import { createDashNode } from './dash-path';
import { createOffsetNode } from './offset';
import { createStrokeToPathNode } from './stroke-to-path';

describe('WASM path ops nodes', () => {
  const backend = new MockPathOps();
  const offsetNode = createOffsetNode(backend);
  const strokeToPathNode = createStrokeToPathNode(backend);
  const dashNode = createDashNode(backend);

  it('should have correct node type definitions', () => {
    expect(offsetNode.type).toBe('offset');
    expect(offsetNode.category).toBe('pathOp');
    expect(strokeToPathNode.type).toBe('strokeToPath');
    expect(dashNode.type).toBe('dashPath');
  });

  it('should run offset node without error', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = offsetNode.execute({ path: { type: 'path', value: rect } }, { distance: 10 });
    expect((result.path as NodeValue).type).toBe('path');
  });

  it('should run stroke-to-path node', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = strokeToPathNode.execute(
      { path: { type: 'path', value: line } },
      { width: 10, cap: 'round', join: 'round' },
    );
    const pathVal = result.path as NodeValue;
    expect(pathVal.type === 'path' && pathVal.value.closed).toBe(true);
  });

  it('should run dash node', () => {
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = dashNode.execute({ path: { type: 'path', value: line } }, { dashArray: '[10, 5]', dashOffset: 0 });
    expect((result.path as NodeValue).type).toBe('path');
  });
});

describe('MockPathOps — direct backend methods', () => {
  it('offset() should return path unchanged (mock passthrough)', () => {
    const backend = new MockPathOps();
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = backend.offset(rect, 5);
    expect(result.commands).toBe(rect.commands);
    expect(result.closed).toBe(rect.closed);
  });

  it('removeSelfIntersections() should return path unchanged (mock passthrough)', () => {
    const backend = new MockPathOps();
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = backend.removeSelfIntersections(line);
    expect(result.commands).toBe(line.commands);
    expect(result.closed).toBe(line.closed);
  });

  it('simplify() should return path unchanged (mock passthrough)', () => {
    const backend = new MockPathOps();
    const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const result = backend.simplify(line, 0.5);
    expect(result.commands).toBe(line.commands);
    expect(result.closed).toBe(line.closed);
  });
});
