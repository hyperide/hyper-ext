export type PositionType = 'static' | 'rel' | 'abs' | 'fixed' | 'sticky';
export type LayoutType = 'layout' | 'col' | 'row' | 'grid';
export type UIKitType = 'tailwind' | 'tamagui' | 'none';
export type ChildrenType =
	| 'text'
	| 'expression'
	| 'expression-complex'
	| 'jsx'
	| undefined;

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

export interface TransitionItem {
	id: string;
	visible: boolean;
	expanded: boolean;
	property: 'all' | 'colors' | 'opacity' | 'transform';
	duration: string;
	timing: 'linear' | 'in' | 'out' | 'in-out';
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
