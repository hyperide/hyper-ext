import { describe, expect, it } from 'bun:test';
import { createDefaultRegistry } from './register-all';

describe('createDefaultRegistry', () => {
  it('should register all built-in node types', () => {
    const registry = createDefaultRegistry();
    const all = registry.listAll();
    // Plan 1: 24 nodes + Plan 2: 21 nodes = 45 total
    expect(all.length).toBe(45);
  });

  it('should have generators category', () => {
    const registry = createDefaultRegistry();
    expect(registry.listByCategory('generator').length).toBeGreaterThanOrEqual(8);
  });

  it('should have pathOp category', () => {
    const registry = createDefaultRegistry();
    expect(registry.listByCategory('pathOp').length).toBeGreaterThanOrEqual(7);
  });

  it('should have style category', () => {
    const registry = createDefaultRegistry();
    expect(registry.listByCategory('style').length).toBeGreaterThanOrEqual(4);
  });

  it('should have transform category', () => {
    const registry = createDefaultRegistry();
    expect(registry.listByCategory('transform').length).toBeGreaterThanOrEqual(4);
  });
});
