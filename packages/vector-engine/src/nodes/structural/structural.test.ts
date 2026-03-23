import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../../path/builder';
import type { NodeValue, PathValue } from '../../types';
import { alphaMaskNode } from './alpha-mask';
import { groupNode } from './group';

describe('group node', () => {
  it('should merge multiple paths into compound path', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const tri = new PathBuilder().moveTo(50, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = groupNode.execute(
      {
        children: [{ type: 'path', value: rect } as NodeValue, { type: 'path', value: tri } as NodeValue],
      },
      { opacity: 0.8 },
    );
    const outPath = (result.path as NodeValue).value as PathValue;
    expect(outPath.commands.length).toBe(rect.commands.length + tri.commands.length);
    expect(outPath.closed).toBe(true);
  });

  it('should handle single child', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).close().build();
    const result = groupNode.execute({ children: { type: 'path', value: rect } as NodeValue }, { opacity: 1 });
    expect((result.path as NodeValue).type).toBe('path');
  });

  it('should handle no children', () => {
    const result = groupNode.execute({}, { opacity: 1 });
    const outPath = (result.path as NodeValue).value as PathValue;
    expect(outPath.commands.length).toBe(0);
  });

  it('should pass through transform input', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
    const transform: NodeValue = { type: 'transform', value: [2, 0, 0, 2, 10, 20] };
    const result = groupNode.execute(
      {
        children: [{ type: 'path', value: rect } as NodeValue],
        transform,
      },
      { opacity: 1 },
    );
    expect(result.transform).toBe(transform);
  });
});

describe('alpha mask node', () => {
  it('should output content path with mask as clipPath', () => {
    const content = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const mask = new PathBuilder().moveTo(20, 20).lineTo(80, 20).lineTo(80, 80).lineTo(20, 80).close().build();
    const result = alphaMaskNode.execute(
      {
        content: { type: 'path', value: content } as NodeValue,
        mask: { type: 'path', value: mask } as NodeValue,
      },
      {},
    );
    expect((result.path as NodeValue).type).toBe('path');
    expect((result.clipPath as NodeValue).type).toBe('path');
  });

  it('should preserve the exact content and mask references', () => {
    const content: NodeValue = {
      type: 'path',
      value: new PathBuilder().moveTo(0, 0).lineTo(50, 50).build(),
    };
    const mask: NodeValue = {
      type: 'path',
      value: new PathBuilder().moveTo(10, 10).lineTo(40, 40).build(),
    };
    const result = alphaMaskNode.execute({ content, mask }, {});
    expect(result.path).toBe(content);
    expect(result.clipPath).toBe(mask);
  });

  it('should return empty path when content is missing', () => {
    const mask: NodeValue = {
      type: 'path',
      value: new PathBuilder().moveTo(10, 10).lineTo(40, 40).build(),
    };
    const result = alphaMaskNode.execute({ mask }, {});
    expect((result.path as NodeValue).type).toBe('path');
    expect((result.path as NodeValue).value).toBeDefined();
    expect(result.clipPath).toBe(mask);
  });

  it('should return empty path when mask is missing', () => {
    const content: NodeValue = {
      type: 'path',
      value: new PathBuilder().moveTo(0, 0).lineTo(100, 0).build(),
    };
    const result = alphaMaskNode.execute({ content }, {});
    expect((result.path as NodeValue).type).toBe('path');
    expect((result.path as NodeValue).value).toBeDefined();
    expect(result.clipPath).toBe(content);
  });

  it('should return empty path when both inputs are missing', () => {
    const result = alphaMaskNode.execute({}, {});
    expect((result.path as NodeValue).type).toBe('path');
    expect(result.clipPath).toBeUndefined();
  });
});
