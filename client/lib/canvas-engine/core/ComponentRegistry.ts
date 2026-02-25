/**
 * Component Registry - manages component definitions
 */

import type { ComponentCategory, ComponentDefinition, FieldsMap } from '../models/types';
import { componentDefinitionSchema } from '../models/validation';

/**
 * Component registry for managing component definitions
 */
export class ComponentRegistry {
  private components: Map<string, ComponentDefinition> = new Map();
  private categories: Map<ComponentCategory, Set<string>> = new Map();

  /**
   * Register a component definition
   * @throws {Error} if component type already exists or validation fails
   */
  register<F extends FieldsMap>(definition: ComponentDefinition<F>): void {
    // Validate definition
    const result = componentDefinitionSchema.safeParse(definition);
    if (!result.success) {
      throw new Error(`Invalid component definition: ${result.error.message}`);
    }

    // Check for duplicates
    if (this.components.has(definition.type)) {
      throw new Error(`Component type "${definition.type}" is already registered`);
    }

    // Store component (cast needed: generic F extends FieldsMap, safe at runtime)
    this.components.set(definition.type, definition as ComponentDefinition);

    // Store category
    if (definition.category) {
      if (!this.categories.has(definition.category)) {
        this.categories.set(definition.category, new Set());
      }
      this.categories.get(definition.category)?.add(definition.type);
    }
  }

  /**
   * Unregister a component definition
   */
  unregister(type: string): boolean {
    const definition = this.components.get(type);
    if (!definition) {
      return false;
    }

    // Remove from categories
    if (definition.category) {
      const categorySet = this.categories.get(definition.category);
      if (categorySet) {
        categorySet.delete(type);
        if (categorySet.size === 0) {
          this.categories.delete(definition.category);
        }
      }
    }

    // Remove component
    return this.components.delete(type);
  }

  /**
   * Get component definition by type
   */
  get(type: string): ComponentDefinition | undefined {
    return this.components.get(type);
  }

  /**
   * Check if component type exists
   */
  has(type: string): boolean {
    return this.components.has(type);
  }

  /**
   * Get all component types
   */
  getAllTypes(): string[] {
    return Array.from(this.components.keys());
  }

  /**
   * Get all component definitions
   */
  getAll(): ComponentDefinition[] {
    return Array.from(this.components.values());
  }

  /**
   * Get components by category
   */
  getByCategory(category: ComponentCategory): ComponentDefinition[] {
    const types = this.categories.get(category);
    if (!types) {
      return [];
    }

    return Array.from(types)
      .map((type) => this.components.get(type))
      .filter((def): def is ComponentDefinition => def !== undefined);
  }

  /**
   * Get all categories
   */
  getCategories(): ComponentCategory[] {
    return Array.from(this.categories.keys());
  }

  /**
   * Get visible components (not hidden)
   */
  getVisible(): ComponentDefinition[] {
    return this.getAll().filter((def) => !def.hidden);
  }

  /**
   * Get visible components by category
   */
  getVisibleByCategory(category: ComponentCategory): ComponentDefinition[] {
    return this.getByCategory(category).filter((def) => !def.hidden);
  }

  /**
   * Validate if parent-child relationship is allowed
   */
  canAddChild(parentType: string, childType: string): boolean {
    const parentDef = this.get(parentType);
    const childDef = this.get(childType);

    if (!parentDef || !childDef) {
      return false;
    }

    // Check if parent can have children
    if (parentDef.canHaveChildren === false) {
      return false;
    }

    // Check parent's allowed children
    if (parentDef.allowedChildren && !parentDef.allowedChildren.includes(childType)) {
      return false;
    }

    // Check child's allowed parents
    if (childDef.allowedParents && !childDef.allowedParents.includes(parentType)) {
      return false;
    }

    return true;
  }

  /**
   * Clear all registered components
   */
  clear(): void {
    this.components.clear();
    this.categories.clear();
  }

  /**
   * Get registry size
   */
  get size(): number {
    return this.components.size;
  }
}
