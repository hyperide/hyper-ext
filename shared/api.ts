/**
 * Shared code between client and server
 * Useful to share types between client and server
 * and/or small pure JS functions that can be used on both client and server
 */

/**
 * Example response type for /api/demo
 */
export interface DemoResponse {
  message: string;
}

/**
 * Nested component structure for recursive children
 * Used in defaultProps to represent component instances
 */
export interface NestedComponent {
  type: string;
  props: Record<string, unknown>;
}

/**
 * Children can be:
 * - string: plain text content
 * - NestedComponent: single component instance
 * - NestedComponent[]: array of component instances
 */
export type ChildrenValue = string | NestedComponent | NestedComponent[];
