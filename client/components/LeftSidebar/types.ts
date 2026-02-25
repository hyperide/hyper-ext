export interface LeftSidebarProps {
  onElementPosition?: (id: string, y: number) => void;
  onHoverElement?: (id: string | null) => void;
  hoveredId?: string | null;
  onOpenPanel?: (id: string) => void;
  onCreatePage?: () => void;
  onCreateComponent?: () => void;
}
