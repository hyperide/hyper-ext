/**
 * ID generation utilities
 */

/**
 * Generate unique ID
 */
export function generateId(prefix = 'instance'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate multiple unique IDs
 */
export function generateIds(count: number, prefix = 'instance'): string[] {
  return Array.from({ length: count }, () => generateId(prefix));
}
