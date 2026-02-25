/**
 * Canvas composition types for multi-instance component rendering
 */

// Using any for excalidraw types due to import complexity
// biome-ignore lint/suspicious/noExplicitAny: excalidraw types not properly exported
type ExcalidrawElement = any;
// biome-ignore lint/suspicious/noExplicitAny: excalidraw types not properly exported
type AppState = any;

export type CanvasMode = 'single' | 'multi';

/**
 * JSON-serializable value for instance props
 */
export type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue };

/**
 * @deprecated Use InstanceConfig instead
 * Legacy type for backward compatibility
 */
export interface InstancePosition {
  x: number;
  y: number;
  width?: number;  // Container width constraint
  height?: number; // Container height constraint
}

/**
 * Test interaction step for E2E tests
 */
export interface CanvasTestInteraction {
  type: 'click' | 'type' | 'hover' | 'focus' | 'blur' | 'select' | 'check' | 'uncheck' | 'wait' | 'press';
  target: string;
  value?: string;
  key?: string;
  delay?: number;
  expect?: {
    visible?: string;
    hidden?: string;
    text?: string;
    attribute?: { name: string; value: string };
    checked?: boolean;
    disabled?: boolean;
  };
}

/**
 * Test-related configuration for canvas instance
 */
export interface InstanceTestConfig {
  /** Tags for filtering/grouping variants (e.g., ['states', 'error', 'loading']) */
  tags?: string[];
  /** Skip this instance for certain test types */
  skip?: {
    unit?: boolean;
    e2e?: boolean;
    snapshot?: boolean;
  };
  /** Expected data-test-id attributes that should be present */
  expectedTestIds?: string[];
  /** Interaction sequence for E2E testing */
  interactions?: CanvasTestInteraction[];
}

/**
 * Full instance configuration with props for UX flow
 */
export interface InstanceConfig {
  x: number;
  y: number;
  width?: number;
  height?: number;
  props: Record<string, SerializableValue>;
  label?: string;
  description?: string;
  /** Test-related configuration */
  testConfig?: InstanceTestConfig;
}

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * Canvas composition with component instances
 * instances can be either legacy InstancePosition or new InstanceConfig
 */
export interface CanvasComposition {
  component: string; // relative path to component (e.g., "src/components/Button.tsx")
  componentName?: string; // component name for props type lookup (e.g., "Button")
  instances: Record<string, InstancePosition | InstanceConfig>;
  viewport: ViewportState;
  annotations?: ExcalidrawElement[]; // Drawing annotations (arrows, text, etc.)
  annotationsAppState?: Partial<AppState>; // Excalidraw app state for annotations
}

/**
 * Type guard to check if instance has props (new format)
 */
export function isInstanceConfig(
  instance: InstancePosition | InstanceConfig
): instance is InstanceConfig {
  return 'props' in instance;
}

/**
 * Convert legacy InstancePosition to InstanceConfig
 */
export function toInstanceConfig(
  instance: InstancePosition | InstanceConfig
): InstanceConfig {
  if (isInstanceConfig(instance)) {
    return instance;
  }
  return {
    ...instance,
    props: {},
  };
}

export interface CanvasState {
  [componentPath: string]: CanvasComposition;
}

// Default values
export const DEFAULT_VIEWPORT: ViewportState = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

export const DEFAULT_INSTANCE_POSITION: InstancePosition = {
  x: 100,
  y: 100,
};

export const DEFAULT_INSTANCE_CONFIG: InstanceConfig = {
  x: 100,
  y: 100,
  props: {},
};

export const GRID_SIZE = 16; // Grid snap size in pixels
