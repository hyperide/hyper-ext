/**
 * @file Node type registry — central store for node type definitions
 *
 * Accessed via: Internal module — central store queried when resolving node types during graph execution
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Node Registry
 */

import type { NodeCategory, NodeTypeDefinition } from '../types';

export class NodeRegistry {
  private types = new Map<string, NodeTypeDefinition>();

  register(definition: NodeTypeDefinition): void {
    if (this.types.has(definition.type)) {
      throw new Error(`Node type "${definition.type}" is already registered`);
    }
    this.types.set(definition.type, definition);
  }

  get(type: string): NodeTypeDefinition | undefined {
    return this.types.get(type);
  }

  listByCategory(category: NodeCategory): NodeTypeDefinition[] {
    return [...this.types.values()].filter((d) => d.category === category);
  }

  listAll(): NodeTypeDefinition[] {
    return [...this.types.values()];
  }
}
