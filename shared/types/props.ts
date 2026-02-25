/**
 * Shared prop type definitions for component props analysis
 */

export interface PropTypeInfo {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'union' | 'object' | 'array' | 'function' | 'reactNode' | 'unknown';
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  enumValues?: string[];
  objectSchema?: Record<string, PropTypeInfo>;
  arrayItemType?: PropTypeInfo;
  tokenCategory?: 'color' | 'size' | 'space';
}

export interface ComponentPropsSchema {
  componentName: string;
  props: Record<string, PropTypeInfo>;
}
