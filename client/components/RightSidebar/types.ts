import type { ComponentGroup } from '../../../lib/component-scanner/types';

export type PositionType = 'static' | 'rel' | 'abs' | 'fixed' | 'sticky' | 'mixed';
export type LayoutType = 'layout' | 'col' | 'row' | 'grid' | 'mixed';
export type UIKitType = 'tailwind' | 'tamagui' | 'none';

export type DesignTokenCategory = 'colors' | 'typography' | 'spacing' | 'shadows' | 'other';

/** A single CSS custom property surfaced in the Inspector empty state. */
export interface DesignToken {
  /** Full property name including leading dashes, e.g. `--color-primary` */
  name: string;
  /** Raw value string, e.g. `#ff0000` or `1rem` */
  value: string;
  category: DesignTokenCategory;
}

export interface RightSidebarProps {
  onOpenSettings?: () => void;
  viewport?: { zoom: number; panX: number; panY: number };
  onZoomChange?: (zoom: number) => void;
  onFitToContent?: () => void;
  activeInstanceId?: string | null;
  onInstanceBadgeClick?: (instanceId: string) => void;
  canvasMode?: 'single' | 'multi';
  instanceSize?: { width: number; height: number };
  onInstanceSizeChange?: (width: number, height: number) => void;
  // Project UI kit data (passed from CanvasEditor)
  projectUIKit?: UIKitType;
  activeProjectId?: string | null;
  activeProjectName?: string | null;
  publicDirExists?: boolean;
  /** Component groups to show when Explorer is hidden (VS Code ext only) */
  componentGroups?: {
    atomGroups: ComponentGroup[];
    compositeGroups: ComponentGroup[];
    pageGroups: ComponentGroup[];
  } | null;
  /** Whether the Explorer sidebar is currently visible */
  explorerVisible?: boolean;
  /** Called when user clicks a component in the empty state list */
  onComponentClick?: (name: string, path: string) => void;
  /** When true, all style-editing inputs are disabled (CSS system not writable) */
  readonly?: boolean;
  /** Design tokens scanned from the project's CSS/SCSS files (shown in empty state) */
  designTokens?: DesignToken[];
}

export interface StrokeItem {
  id: string;
  visible: boolean;
  color: string;
  opacity: string;
  width: string;
  style: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  sides: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
}

export interface EffectItem {
  id: string;
  visible: boolean;
  type: 'drop-shadow' | 'inner-shadow' | 'blur';
  x?: string;
  y?: string;
  blur?: string;
  spread?: string;
  value?: string;
  color: string;
  opacity: string;
  preset?: string;
}

export interface LayoutOption {
  row: number;
  col: number;
  justify: string;
  align: string;
}

export interface SizePreset {
  label: string;
  width: number;
  height: number;
}
