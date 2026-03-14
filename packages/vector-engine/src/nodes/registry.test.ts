import { beforeEach, describe, expect, it } from 'bun:test';
import type { NodeTypeDefinition } from '../types';
import { NodeRegistry } from './registry';

const dummyNode: NodeTypeDefinition = {
  type: 'test-rect',
  label: 'Test Rectangle',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'width', type: 'number', default: 100 },
    { name: 'height', type: 'number', default: 100 },
  ],
  execute: (_inputs, _params) => ({
    path: {
      type: 'path',
      value: { commands: new Float64Array(0), closed: true },
    },
  }),
};

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  it('should register and retrieve a node type', () => {
    registry.register(dummyNode);
    const def = registry.get('test-rect');
    expect(def).toBeDefined();
    expect(def?.label).toBe('Test Rectangle');
  });

  it('should return undefined for unknown types', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should throw on duplicate registration', () => {
    registry.register(dummyNode);
    expect(() => registry.register(dummyNode)).toThrow(/already registered/);
  });

  it('should list types by category', () => {
    registry.register(dummyNode);
    const generators = registry.listByCategory('generator');
    expect(generators).toHaveLength(1);
    expect(generators[0].type).toBe('test-rect');
  });

  it('should list all registered types', () => {
    registry.register(dummyNode);
    expect(registry.listAll()).toHaveLength(1);
  });
});
