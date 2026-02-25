/**
 * Document Tree - manages tree structure of component instances
 */

import type { ComponentInstance, DocumentTree as IDocumentTree } from "../models/types";
import { componentInstanceSchema } from "../models/validation";
import { generateId } from "../utils/id";

/**
 * Document tree manager
 */
export class DocumentTree {
  private instances: Map<string, ComponentInstance> = new Map();
  private rootId: string;
  private version: number = 1;

  constructor(initialTree?: Partial<IDocumentTree>) {
    if (initialTree?.rootId && initialTree?.instances) {
      // Load from existing tree
      this.rootId = initialTree.rootId;
      this.version = initialTree.version ?? 1;

      Object.entries(initialTree.instances).forEach(([id, instance]) => {
        this.instances.set(id, instance);
      });
    } else {
      // Create root instance
      this.rootId = generateId("root");
      this.instances.set(this.rootId, {
        id: this.rootId,
        type: "root",
        props: {},
        parentId: null,
        children: [],
        metadata: {
          createdAt: Date.now(),
        },
      });
    }
  }

  /**
   * Get root ID
   */
  getRootId(): string {
    return this.rootId;
  }

  /**
   * Get root instance
   */
  getRoot(): ComponentInstance {
    const root = this.instances.get(this.rootId);
    if (!root) {
      throw new Error("Root instance not found");
    }
    return root;
  }

  /**
   * Get instance by ID
   */
  getInstance(id: string): ComponentInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * Check if instance exists
   */
  hasInstance(id: string): boolean {
    return this.instances.has(id);
  }

  /**
   * Get all instances
   */
  getAllInstances(): ComponentInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get children of an instance
   */
  getChildren(parentId: string): ComponentInstance[] {
    const parent = this.instances.get(parentId);
    if (!parent) {
      return [];
    }

    return parent.children
      .map((childId) => this.instances.get(childId))
      .filter((child): child is ComponentInstance => child !== undefined);
  }

  /**
   * Get parent of an instance
   */
  getParent(id: string): ComponentInstance | null {
    const instance = this.instances.get(id);
    if (!instance || !instance.parentId) {
      return null;
    }

    return this.instances.get(instance.parentId) ?? null;
  }

  /**
   * Get ancestors of an instance (parents up to root)
   */
  getAncestors(id: string): ComponentInstance[] {
    const ancestors: ComponentInstance[] = [];
    let current = this.getInstance(id);

    while (current && current.parentId) {
      const parent = this.instances.get(current.parentId);
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }

    return ancestors;
  }

  /**
   * Get descendants of an instance (all children recursively)
   */
  getDescendants(id: string): ComponentInstance[] {
    const descendants: ComponentInstance[] = [];
    const queue: string[] = [id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = this.getChildren(currentId);

      for (const child of children) {
        descendants.push(child);
        queue.push(child.id);
      }
    }

    return descendants;
  }

  /**
   * Insert instance
   */
  insert(
    type: string,
    props: Record<string, any>,
    parentId: string | null = this.rootId,
    index?: number,
    id?: string
  ): ComponentInstance {
    // Resolve parent ID (null means root)
    const resolvedParentId = parentId ?? this.rootId;

    // Validate parent exists
    if (resolvedParentId && !this.instances.has(resolvedParentId)) {
      throw new Error(`Parent instance "${resolvedParentId}" not found`);
    }

    // Generate or use provided ID
    const instanceId = id || generateId("instance");

    // Create instance
    const instance: ComponentInstance = {
      id: instanceId,
      type,
      props,
      parentId: resolvedParentId,
      children: [],
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };

    // Validate instance
    const result = componentInstanceSchema.safeParse(instance);
    if (!result.success) {
      throw new Error(`Invalid instance: ${result.error.message}`);
    }

    // Add to instances
    this.instances.set(instanceId, instance);

    // Add to parent's children
    if (resolvedParentId) {
      const parent = this.instances.get(resolvedParentId)!;
      if (index !== undefined && index >= 0 && index <= parent.children.length) {
        parent.children.splice(index, 0, instanceId);
      } else {
        parent.children.push(instanceId);
      }
    }

    this.incrementVersion();
    return instance;
  }

  /**
   * Update instance props
   */
  update(id: string, props: Partial<Record<string, any>>): ComponentInstance {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Instance "${id}" not found`);
    }

    // Merge props
    instance.props = { ...instance.props, ...props };

    // Update metadata
    instance.metadata = {
      ...instance.metadata,
      updatedAt: Date.now(),
    };

    this.incrementVersion();
    return instance;
  }

  /**
   * Delete instance (and all descendants)
   */
  delete(id: string): ComponentInstance {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Instance "${id}" not found`);
    }

    // Cannot delete root
    if (id === this.rootId) {
      throw new Error("Cannot delete root instance");
    }

    // Remove from parent's children
    if (instance.parentId) {
      const parent = this.instances.get(instance.parentId);
      if (parent) {
        parent.children = parent.children.filter((childId) => childId !== id);
      }
    }

    // Delete all descendants
    const descendants = this.getDescendants(id);
    descendants.forEach((descendant) => {
      this.instances.delete(descendant.id);
    });

    // Delete instance
    this.instances.delete(id);

    this.incrementVersion();
    return instance;
  }

  /**
   * Move instance to new parent/position
   */
  move(
    id: string,
    newParentId: string | null,
    newIndex?: number
  ): ComponentInstance {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Instance "${id}" not found`);
    }

    // Cannot move root
    if (id === this.rootId) {
      throw new Error("Cannot move root instance");
    }

    // Validate new parent exists
    if (newParentId && !this.instances.has(newParentId)) {
      throw new Error(`New parent "${newParentId}" not found`);
    }

    // Prevent circular reference (moving to own descendant)
    if (newParentId) {
      const descendants = this.getDescendants(id);
      if (descendants.some((d) => d.id === newParentId)) {
        throw new Error("Cannot move instance to its own descendant");
      }
    }

    // Remove from old parent
    if (instance.parentId) {
      const oldParent = this.instances.get(instance.parentId);
      if (oldParent) {
        oldParent.children = oldParent.children.filter(
          (childId) => childId !== id
        );
      }
    }

    // Add to new parent
    instance.parentId = newParentId;
    if (newParentId) {
      const newParent = this.instances.get(newParentId)!;
      if (newIndex !== undefined && newIndex >= 0 && newIndex <= newParent.children.length) {
        newParent.children.splice(newIndex, 0, id);
      } else {
        newParent.children.push(id);
      }
    }

    // Update metadata
    instance.metadata = {
      ...instance.metadata,
      updatedAt: Date.now(),
    };

    this.incrementVersion();
    return instance;
  }

  /**
   * Clone instance (deep copy with new IDs)
   */
  clone(id: string, newParentId?: string | null): ComponentInstance {
    const original = this.instances.get(id);
    if (!original) {
      throw new Error(`Instance "${id}" not found`);
    }

    const parentId = newParentId !== undefined ? newParentId : original.parentId;

    // Clone instance
    const clone = this.insert(
      original.type,
      { ...original.props },
      parentId
    );

    // Clone children recursively
    for (const childId of original.children) {
      this.clone(childId, clone.id);
    }

    return clone;
  }

  /**
   * Get tree snapshot (for serialization)
   */
  toSnapshot(): IDocumentTree {
    const instances: Record<string, ComponentInstance> = {};
    this.instances.forEach((instance, id) => {
      instances[id] = instance;
    });

    return {
      rootId: this.rootId,
      instances,
      version: this.version,
    };
  }

  /**
   * Get instance count
   */
  get size(): number {
    return this.instances.size;
  }

  /**
   * Increment tree version
   */
  private incrementVersion(): void {
    this.version++;
  }

  /**
   * Get current version
   */
  getVersion(): number {
    return this.version;
  }
}
