export interface LeftSidebarProps {
	onElementPosition?: (id: string, y: number) => void;
	onHoverElement?: (id: string | null) => void;
	hoveredId?: string | null;
	onOpenPanel?: (id: string) => void;
	projectPath?: string;
	onCreatePage?: () => void;
	onCreateComponent?: () => void;
}
